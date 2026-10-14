import { DIRTY_FILE_ADMISSION_OPERATIONS, SaveBarrierRefusedError, buildDirtyFileAdmission, saveBarrierRefusal } from './dirty-file-admission.js';
import { assertSameFilePathIdentity, matchingDocumentPaths, proveSaveSessionIdentity, withFilePathComparisons } from './file-path-identity.js';
import { lstat, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CursorSigner } from './cursor.js';
import { documentKeyMatches } from './document-key.js';
import { OperationSafetyRegistry } from './operation-safety-policy-core.js';
import { DeleteBackupError, verifyDeleteBackup } from './delete-shared.js';
import { DELETE_INSPECT_SCRIPT, DELETE_REVERT_SCRIPT, reconcileDeleteResultSchema, } from './delete-recovery.js';
import { canonicalSha256 } from './mutation-canonical.js';
import { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS, READ_PAGE_ITEM_AT_HELPER } from './page-item-walk.js';
import { DocumentMismatchError, hostReferenceInvalidDetail, hostReferenceInvalidReason, IndeterminateExecutionError, InvalidCursorError, ObjectAttributeUnreadableError, ObjectNotFoundError, ReadScanLimitError, ProvenPreApplyFailureError, StaleCursorError, } from './domain.js';
import { defaultMutationOperationRegistry } from './default-mutation-operation-adapters.js';
import { LIST_TEXT_STYLES_SCRIPT } from './text-style-resources.js';
import { FIND_FONTS_QUERY_BYTE_LIMIT, FIND_FONTS_QUERY_SCRIPT, FIND_FONTS_SCRIPT, FONT_SEARCH_PAGE_SIZE, fontCursorSchema, fontLookupInputSchema, fontLookupResultSchema, fontQueryHostResultSchema, fontQueryNeedles, fontQuerySchema, fontSearchResultSchema, selectFontSearchPage } from './font-lookup.js';
import { SystemFontVerifier } from './font-verification.js';
import { CAPTURE_CLEAN_FONT_INVENTORY_SCRIPT, IllustratorFontInventory } from './illustrator-font-inventory.js';
import { areaColumnsErrorMessage, GET_AREA_TEXT_OPTIONS_SCRIPT, getAreaTextOptionsResultSchema, } from './area-text-options.js';
import { GET_PATH_POINTS_SCRIPT, getPathPointsResultSchema, pathEditErrorMessage } from './path-points.js';
import { AUDIT_JAPANESE_TYPOGRAPHY_SCRIPT, judgeJapaneseTypography, jpAuditErrorMessage, jpAuditHostDataSchema, jpAuditPolicyError, } from './jp-typography-audit.js';
import { executeM6P0AppearancePreviewRecipe, m6P0RecipeResultSchema, } from './m6-p0-recipe.js';
import { defaultStateRoot } from './command-store.js';
import { BACKUP_CLOSE_RESTORE_TEST_SCRIPT, BACKUP_CAPTURE_BASELINE_JSX, backupBaselineHostDataSchema, backupSessionSchema, documentsOutsideBackupBaseline, hostDocumentIdentitySchema, BACKUP_INVENTORY_SCRIPT, BACKUP_MAX_PAGE_ITEMS, BACKUP_STREAM_MAX_PAGE_ITEMS, LARGE_DOCUMENT_WORKAROUND, backupTooLargeMessage, BACKUP_OPEN_PRE_ATTEMPT_CODES, BACKUP_OPEN_RESTORE_TEST_SCRIPT, BACKUP_RECONCILE_CLOSE_SCRIPT, backupFileName, BackupCopyError, BackupPreconditionError, BackupRecordError, BackupSessionGoneError, BackupSessionUnresolvedError, BackupSessionCapacityError, compareRestoredStructure, EMPTY_COMPOUND_DROPPED_ON_SAVE, explainRestoredStructure, copyErrorCreatedDestination, copyFileExclusive, deepDifferences, DocumentBackupStore, hostPathForms, inspectSourceFile, newBackupId, removeRestoreTestFile, resolveBackupRoot, restoreTestFileName, sameFileOrSameBytes, sameFilePath, serializeFileIdentity, verifyTrackedFile, withBackupRootScope, BACKUP_REQUIRES_SAVED_FILE_MESSAGE, } from './document-backup.js';
import { assertOutputAbsent, closeRefusalReason, createStagingDirectory, DocumentExportStore, EXPORT_CLOSE_REFUSED_CODE, EXPORT_CLOSE_WORK_COPY_SCRIPT, EXPORT_HOST_TIMEOUT_MS, EXPORT_INVENTORY_SCRIPT, EXPORT_OPEN_PRE_ATTEMPT_CODES, EXPORT_OPEN_WORK_COPY_SCRIPT, hostRecordIdentityOf, EXPORT_OUTLINE_SCRIPT, EXPORT_READ_SOURCE_SCRIPT, EXPORT_REGISTRATION_SCAN_LIMITS, EXPORT_RECONCILE_CLOSE_SCRIPT, EXPORT_SAVE_FAILED_CODE, EXPORT_SAVE_OUTPUT_SCRIPT, EXPORT_SAVE_PRE_ATTEMPT_CODES, ExportPreconditionError, ExportSessionGoneError, ExportSessionUnresolvedError, newExportId, OutputPublishError, OutputVerificationError, parseExportHostError, publishOutput, scanPdfObjects, validateOutputPath, verifyOutputFile, verifyOutputUnchanged, withOutputParentScope, workCopyFileName, EXPORT_REQUIRES_SAVED_FILE_MESSAGE, } from './document-export.js';
import { LeaseGuard, UnresolvedLeaseError } from './lease-guard.js';
import { marksNeedRegistrationScan, PDF_EXPORT_SAVE_PRE_ATTEMPT_CODES, PDF_EXPORT_SAVE_PRESERVE_SCRIPT, PDF_EXPORT_SAVE_SCRIPT, pdfFacts, pdfSaveParams, preserveEditabilityOptions, PDFX_FONT_SCAN_FRAME_LIMIT, pdfxFontRefusal, pdfxReport, planPdfExport, normalizePdfBleed, presetReport, registrationScanWarnings, verifyPdfStructure, } from './pdf-export.js';
import { SaveAsLeaseChangedError, SaveAsLeaseNotRecordedError, SaveAsLeaseRegistry, SaveAsSessionStore, UF_HIDDEN, newSaveAsId, syncDirectoryOf, syncFile } from './save-as-session.js';
import { isMissingPath } from './private-state.js';
import { classifySaveAs, collectSaveAsFacts, outputHiddenOf, outputIsDataless } from './save-as-reconcile.js';
import { RasterExportOperation, RasterExportReconciler, rasterExportInputSchema, rasterQuarantinePaths, } from './raster-export.js';
import { RasterBatchExportOperation, isBatchExportId, isBatchInput, rasterBatchInputSchema } from './raster-batch-export.js';
import { RasterBatchExportReconciler } from './raster-batch-export-reconcile.js';
import { EditSessionStore } from './edit-session.js';
import { EditSessionCoordinator } from './edit-session-coordinator.js';
import { EDIT_SESSION_FOREGROUND_HINT, EDIT_SESSION_RESTART_HINT, EDIT_SESSION_OPEN_SCRIPT, editSessionRefusal, editSessionScanIncompleteMessage, saveSessionSuspension, editSessionTooLargeNote, listEditSessionsResult, summarizeEditSession, } from './edit-session-tools.js';
import { NOT_SAVED_FILE_SESSION_HINT, USER_SAVED_SESSION_HINT } from './unsaved-document-guidance.js';
import { EDIT_SESSION_MAX_ITEMS, EDIT_SESSION_SCAN_DEADLINE_MS } from './edit-session.js';
import { chunkedAggregateText, editSessionChunkSchema, EditSessionNotSavedFileError, EditSessionOpenScans, EditSessionScanError, EDIT_SESSION_CHUNKED_MAX_ITEMS, EDIT_SESSION_CHUNKED_MAX_TOTAL_MS, EDIT_SESSION_CHUNK_TIMEOUT_MS, EDIT_SESSION_SCAN_MARGIN_MS, editSessionScanTiming, readEditSessionScanIdentity, } from './edit-session-chunked-scan.js';
import { readStructureStream, StructureSpool, StructureStreamError } from './structure-stream.js';
import { assertCanonicalDocumentPath, CLOSE_DOCUMENT_SCRIPT, fileRevisionSize, LIFECYCLE_HOST_TIMEOUT_MS, LIFECYCLE_READ_SCRIPT, LifecyclePreconditionError, linkStagedToOutput, OPEN_DOCUMENT_SCRIPT, OutputLinkError, readFileFacts, removeStagedFile, SAVE_AS_STAGING_PREFIX, SAVE_AS_SWITCH_SCRIPT, SAVE_AS_INVENTORY_SCRIPT, sameContentIdentity, SAVE_DOCUMENT_AS_SCRIPT, SAVE_DOCUMENT_SCRIPT, serializeFileFacts, validateOpenPath, withApplication, } from './document-lifecycle.js';
import { CREATE_DOCUMENT_HOST_TIMEOUT_MS, CREATE_DOCUMENT_SCRIPT, } from './document-create.js';
import { M6P0RecipeAuthorityStore } from './m6-p0-recipe-store.js';
import { listRecipes, planRecipe, runRecipe, saveRecipe, } from './recipe.js';
import { RecipeExecutionAuthorityStore } from './recipe-execution-authority.js';
import { RecipeStore } from './recipe-store.js';
import { SipsImageFileInspector } from './image-file-inspector.js';
import { createImagePreflightItem, ImageObjectRequiredError, } from './image-preflight.js';
import { createPrintPreflightResult, PRINT_PREFLIGHT_LIMITS, } from './print-preflight.js';
import { PREFLIGHT_SCOPE_NOTE } from './preflight-scope-note.js';
import { computeStructureDiff, pageStructureDiff, assertStructurePagePlan, STRUCTURE_PAGE_LIMITS, STRUCTURE_SNAPSHOT_LIMITS, StructureDiffStore, StructureSnapshotChangedError, StructureSnapshotPagePlanError, StructureSnapshotStore, StructureSnapshotTooLargeError, summarizeStructureSnapshot, validateStructureDiffCursor, } from './structure-diff.js';
import { checkTextConsistency, computeContrastPairs, contrastAutoDetectUnsupportedProfile, createDesignTokens, DESIGN_ANALYSIS_LIMITS, detectContrastOverlaps, } from './design-analysis.js';
import { assertConsistentColorRead, buildReplacementPlanEntries, colorReplacementSnapshotDigest, findColorUsages, validateColorMatch, } from './color-replacement.js';
import { OsascriptHostProfileProbe } from './host-profile.js';
import { capturePreview } from './document-preview.js';
import { renderArtboards, RenderSetStore } from './artboard-render.js';
import { extractText } from './text-extract.js';
import { decodeBarcodeRaster } from './barcode/raster-decode.js';
import { decodeQrRaster } from './qr/raster-decode.js';
import { analyzeDisplaySpacing } from './display-spacing.js';
import { classifyRasters, IMAGE_OPTIMIZE_BASELINE_CODES, IMAGE_OPTIMIZE_BASELINE_SCRIPT, IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT, IMAGE_OPTIMIZE_CLOSE_WORK_COPY_SCRIPT, assertRenderBaseName, IMAGE_OPTIMIZE_HOST_TIMEOUT_MS, IMAGE_OPTIMIZE_ICC_NOTE, IMAGE_OPTIMIZE_MAX_SCANNED_IMAGES, IMAGE_OPTIMIZE_MAX_TARGETS, IMAGE_OPTIMIZE_QUALITY_CONTRACT, IMAGE_OPTIMIZE_RASTERIZE_SCRIPT, IMAGE_OPTIMIZE_READ_SOURCE_SCRIPT, IMAGE_OPTIMIZE_VERSION_GUARD, IMAGE_OPTIMIZE_RENDER_MAX_PIXELS, IMAGE_OPTIMIZE_SAVE_FAILED_CODE, IMAGE_OPTIMIZE_SAVE_PRE_ATTEMPT_CODES, IMAGE_OPTIMIZE_SAVE_SCRIPT, imageOptimizeSaveOptions, renderGeometry, renderQualityProblem, verifyTargetResult, workCopyDifferences, } from './image-optimize.js';
import { comparePngImages, readStableImage } from './visual-diff.js';
import { ImageOptimizeEvidenceError, retainImageOptimizeEvidence } from './image-optimize-evidence.js';
import { HOST_VERSION_POLICY_JSX, evaluateHostVersion, hostVersionAdmitted } from './host-version-policy.js';
import { admitHostVersionPlan, HostVersionChannelRefusedError } from './host-version-admission.js';
import { directoryFlags } from './platform-primitives.js';
import { ARTBOARD_INTEGER_TOLERANCE } from './artboard-integer.js';
import { ZodError } from 'zod';
import { describeUnreadableTextReads } from './unreadable-text-reads.js';
import { formatToolArgumentError, summarizeValidationFailure, toolArgumentIssueMessage } from './tool-arguments.js';
const GET_CONTEXT_SCRIPT = `var result = getDocumentContext();`;
function isMeasuredLineHeightProfile(observation, appVersion) {
    return hostVersionAdmitted('line_height_read', appVersion) && observation.profile === 'foreground' &&
        observation.lockState === 'unlocked' && observation.expectedBundleId !== null &&
        observation.frontmostBundleId === observation.expectedBundleId;
}
export { OBJECT_WALK_HELPERS, OBJECT_WITNESS_HELPERS };
export const OBJECT_READ_HELPERS = `${READ_PAGE_ITEM_AT_HELPER}
function getLayerPath(doc, targetLayer) {
  var path = [];
  var current = targetLayer;
  while (current && current.typename === "Layer") {
    var collection = current.parent.typename === "Document" ? doc.layers : current.parent.layers;
    var foundIndex = -1;
    for (var layerIndex = 0; layerIndex < collection.length; layerIndex++) {
      if (collection[layerIndex] === current) { foundIndex = layerIndex; break; }
    }
    if (foundIndex < 0) throw new Error("Could not resolve PageItem layer path.");
    path.unshift(foundIndex);
    current = current.parent;
  }
  return path;
}

function sameNumberArray(left, right) {
  if (left.length !== right.length) return false;
  for (var index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function boundsMatch(itemBounds, filterBounds, mode) {
  if (filterBounds === null) return true;
  // An edge that sits on the filter edge within the integer tolerance is on it (an artboard edge carries host float noise).
  var slack = ${ARTBOARD_INTEGER_TOLERANCE};
  if (mode === "contained") {
    return itemBounds[0] >= filterBounds[0] - slack && itemBounds[1] <= filterBounds[1] + slack &&
      itemBounds[2] <= filterBounds[2] + slack && itemBounds[3] >= filterBounds[3] - slack;
  }
  return itemBounds[0] <= filterBounds[2] + slack && itemBounds[2] >= filterBounds[0] - slack &&
    itemBounds[1] >= filterBounds[3] - slack && itemBounds[3] <= filterBounds[1] + slack;
}

function summarizePageItem(item, layerPath, bounds) {
  return {
    uuid: String(item.uuid),
    type: item.typename,
    name: item.name || "",
    layer: { name: item.layer.name || "", path: layerPath },
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]]
  };
}
`;
export const OBJECT_DETAIL_HELPERS = `
var OBJECT_DETAIL_LIMITS = {
  contentCharacters: 10000,
  paragraphs: 100,
  paragraphPreviewCharacters: 200,
  scannedCharacters: 5000,
  scannedTextRuns: 400,
  styleRuns: 32,
  textPaintRuns: 200,
  fonts: 100,
  missingFontRanges: 100,
  unreadable: 128
};

function truncateUtf16(value, limit) {
  if (value.length <= limit) return value;
  var end = limit;
  if (end > 0) {
    var previous = value.charCodeAt(end - 1);
    var next = value.charCodeAt(end);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--;
  }
  return value.substring(0, end);
}

function detailErrorMessage(error) {
  var message = error && error.message ? String(error.message) : String(error);
  return truncateUtf16(message, 500);
}

function availableDetail(value) { return { status: "available", value: value }; }
function notApplicableDetail(reason) { return { status: "not_applicable", reason: reason }; }
function unavailableDetail(reason, error) {
  return { status: "unavailable", reason: reason, message: detailErrorMessage(error) };
}

function detailNumber(value, propertyName) {
  var number = Number(value);
  if (typeof value !== "number" || isNaN(number) || !isFinite(number)) {
    throw new Error(propertyName + " is not an available finite number.");
  }
  return number;
}

function detailNumberInRange(value, propertyName, minimum, maximum) {
  var number = detailNumber(value, propertyName);
  if (number < minimum || (maximum !== null && number > maximum)) {
    var range = maximum === null ? String(minimum) + " or greater" : String(minimum) + ".." + String(maximum);
    throw new Error(propertyName + " is outside the supported range " + range + ".");
  }
  return number;
}

function detailBoolean(value, propertyName) {
  if (typeof value !== "boolean") throw new Error(propertyName + " is not an available boolean.");
  return value;
}

function detailString(value, propertyName) {
  if (typeof value !== "string") throw new Error(propertyName + " is not an available string.");
  return value;
}

function summarizeColor(color, depth) {
  if (color === null || color === undefined) throw new Error("Color is unavailable.");
  var typename = detailString(color.typename, "color.typename");
  if (!typename) throw new Error("color.typename is empty.");
  if (typename === "NoColor") return { model: "none" };
  if (typename === "GrayColor") return { model: "gray", gray: detailNumberInRange(color.gray, "gray", 0, 100) };
  if (typename === "RGBColor") return {
    model: "rgb", red: detailNumberInRange(color.red, "red", 0, 255),
    green: detailNumberInRange(color.green, "green", 0, 255),
    blue: detailNumberInRange(color.blue, "blue", 0, 255)
  };
  if (typename === "CMYKColor") return {
    model: "cmyk", cyan: detailNumberInRange(color.cyan, "cyan", 0, 100),
    magenta: detailNumberInRange(color.magenta, "magenta", 0, 100),
    yellow: detailNumberInRange(color.yellow, "yellow", 0, 100),
    black: detailNumberInRange(color.black, "black", 0, 100)
  };
  if (typename === "LabColor") return {
    model: "lab", lightness: detailNumberInRange(color.l, "lightness", -128, 128),
    a: detailNumberInRange(color.a, "a", -128, 128), b: detailNumberInRange(color.b, "b", -128, 128)
  };
  if (typename === "SpotColor") {
    var spotName = detailString(color.spot.name, "spot.name");
    var baseColor = { model: "unknown", typename: "NestedSpotColor" };
    if (depth < 1) {
      baseColor = summarizeColor(color.spot.color, depth + 1);
      if (baseColor.model === "spot") baseColor = { model: "unknown", typename: "NestedSpotColor" };
    }
    return {
      model: "spot", name: spotName, tint: detailNumberInRange(color.tint, "tint", 0, 100), baseColor: baseColor
    };
  }
  if (typename === "GradientColor") {
    var gradientName = detailString(color.gradient.name, "gradient.name");
    var gradientTypeValue = String(color.gradient.type);
    var gradientType = gradientTypeValue === "GradientType.LINEAR" ? "linear" :
      (gradientTypeValue === "GradientType.RADIAL" ? "radial" : null);
    if (gradientType === null) throw new Error("gradient.type is unsupported.");
    if (!color.gradient.gradientStops || color.gradient.gradientStops.length < 2 ||
        color.gradient.gradientStops.length > 32) throw new Error("gradient stop count is outside 2..32.");
    var gradientStops = [];
    for (var gradientStopIndex = 0; gradientStopIndex < color.gradient.gradientStops.length; gradientStopIndex++) {
      var gradientStop = color.gradient.gradientStops[gradientStopIndex];
      if (!gradientStop.color || gradientStop.color.typename === "GradientColor") {
        throw new Error("nested gradient stop color is unsupported.");
      }
      var gradientStopColor = summarizeColor(gradientStop.color, 0);
      if (gradientStopColor.model === "none" || gradientStopColor.model === "gradient" ||
          gradientStopColor.model === "pattern" || gradientStopColor.model === "unknown") {
        throw new Error("gradient stop color is unsupported.");
      }
      gradientStops.push({
        rampPoint: detailNumberInRange(gradientStop.rampPoint, "gradientStop.rampPoint", 0, 100),
        midPoint: detailNumberInRange(gradientStop.midPoint, "gradientStop.midPoint", 13, 87),
        opacity: detailNumberInRange(gradientStop.opacity, "gradientStop.opacity", 0, 100),
        color: gradientStopColor
      });
    }
    if (!color.matrix) throw new Error("gradient.matrix is unavailable.");
    var matrixA = detailNumber(color.matrix.mValueA, "gradient.matrix.a");
    var matrixB = detailNumber(color.matrix.mValueB, "gradient.matrix.b");
    if (matrixA === 0 && matrixB === 0) throw new Error("gradient.matrix angle is indeterminate.");
    var gradientAngle = Math.atan2(matrixB, matrixA) * 180 / Math.PI;
    gradientAngle = ((gradientAngle + 180) % 360 + 360) % 360 - 180;
    gradientAngle = Math.round(gradientAngle * 100000) / 100000;
    if (gradientAngle === 0) gradientAngle = 0;
    return { model: "gradient", name: gradientName, type: gradientType, angle: gradientAngle, stops: gradientStops };
  }
  if (typename === "PatternColor") {
    var patternName = detailString(color.pattern.name, "pattern.name");
    return { model: "pattern", name: patternName };
  }
  return { model: "unknown", typename: typename };
}

function readColorDetail(attributes, propertyName, unavailableReason) {
  try { return availableDetail(summarizeColor(attributes[propertyName], 0)); }
  catch (error) { return unavailableDetail(unavailableReason, error); }
}

function readObjectAppearance(item) {
  var opacity;
  try { opacity = availableDetail(detailNumberInRange(item.opacity, "opacity", 0, 100)); }
  catch (opacityError) { opacity = unavailableDetail("opacity_unavailable", opacityError); }

  var attributes = null;
  var fillEnabled = null;
  var strokeEnabled = null;
  var strokeWidthProperty = null;
  var fillStateError = null;
  var strokeStateError = null;
  if (item.typename === "PathItem") {
    attributes = item;
    strokeWidthProperty = "strokeWidth";
    try { fillEnabled = detailBoolean(item.filled, "filled"); } catch (fillFlagError) { fillStateError = fillFlagError; }
    try { strokeEnabled = detailBoolean(item.stroked, "stroked"); } catch (strokeFlagError) { strokeStateError = strokeFlagError; }
  } else if (item.typename === "TextFrame") {
    try {
      attributes = item.textRange.characterAttributes;
      strokeWidthProperty = "strokeWeight";
      fillEnabled = true;
      strokeEnabled = true;
    } catch (textAppearanceError) {
      return {
        opacity: opacity,
        fill: unavailableDetail("paint_unavailable", textAppearanceError),
        stroke: unavailableDetail("paint_unavailable", textAppearanceError)
      };
    }
  }

  if (attributes === null) {
    return {
      opacity: opacity,
      fill: notApplicableDetail("unsupported_object_type"),
      stroke: notApplicableDetail("unsupported_object_type")
    };
  }

  var fill;
  if (fillStateError !== null) {
    fill = unavailableDetail("paint_unavailable", fillStateError);
  } else if (fillEnabled === false) {
    fill = notApplicableDetail("paint_disabled");
  } else {
    fill = readColorDetail(attributes, "fillColor", "paint_unavailable");
  }
  var stroke;
  if (strokeStateError !== null) {
    stroke = unavailableDetail("paint_unavailable", strokeStateError);
  } else if (strokeEnabled === false) {
    stroke = notApplicableDetail("paint_disabled");
  } else {
    try {
      stroke = availableDetail({
        color: summarizeColor(attributes.strokeColor, 0),
        width: detailNumberInRange(attributes[strokeWidthProperty], strokeWidthProperty, 0, null)
      });
    } catch (strokeError) {
      stroke = unavailableDetail("paint_unavailable", strokeError);
    }
  }
  return { opacity: opacity, fill: fill, stroke: stroke };
}

var fontCatalogCache = [];
var installedFontNames = null;
var installedFontCatalogError = null;

function loadInstalledFontNames() {
  if (installedFontNames !== null || installedFontCatalogError !== null) return;
  try {
    installedFontNames = [];
    var installedFontCount = detailNumberInRange(app.textFonts.length, "app.textFonts.length", 0, 100000);
    if (installedFontCount % 1 !== 0) throw new Error("app.textFonts.length is not an integer.");
    for (var installedFontIndex = 0; installedFontIndex < installedFontCount; installedFontIndex++) {
      installedFontNames.push(detailString(app.textFonts[installedFontIndex].name, "app.textFonts[index].name"));
    }
  } catch (catalogError) {
    installedFontNames = null;
    installedFontCatalogError = detailErrorMessage(catalogError);
  }
}

function verifyInstalledFont(postScriptName) {
  for (var cacheIndex = 0; cacheIndex < fontCatalogCache.length; cacheIndex++) {
    if (fontCatalogCache[cacheIndex].name === postScriptName) return fontCatalogCache[cacheIndex];
  }
  loadInstalledFontNames();
  var result = null;
  if (installedFontCatalogError !== null) {
    result = {
      name: postScriptName,
      available: false,
      reason: "font_unavailable",
      message: installedFontCatalogError
    };
  } else {
    var installed = false;
    for (var installedNameIndex = 0; installedNameIndex < installedFontNames.length; installedNameIndex++) {
      if (installedFontNames[installedNameIndex] === postScriptName) { installed = true; break; }
    }
    if (installed) {
      result = { name: postScriptName, available: true, reason: null, message: null };
    } else {
      result = {
        name: postScriptName,
        available: false,
        reason: "font_missing",
        message: "The font is not present in Illustrator's installed font collection."
      };
    }
  }
  fontCatalogCache.push(result);
  return result;
}

function readFontDetail(attributes) {
  try {
    var font = attributes.textFont;
    var fontValue = {
      family: detailString(font.family, "textFont.family"),
      style: detailString(font.style, "textFont.style"),
      postScriptName: detailString(font.name, "textFont.name")
    };
    var catalogResult = verifyInstalledFont(fontValue.postScriptName);
    if (!catalogResult.available) {
      return {
        status: "unavailable",
        reason: catalogResult.reason,
        message: catalogResult.message,
        fontName: fontValue.postScriptName || null
      };
    }
    return availableDetail(fontValue);
  } catch (fontError) {
    return {
      status: "unavailable",
        reason: "font_unavailable",
      message: detailErrorMessage(fontError),
      fontName: null
    };
  }
}

function readNumberDetail(attributes, propertyName) {
  try { return availableDetail(detailNumber(attributes[propertyName], propertyName)); }
  catch (styleError) { return unavailableDetail("character_style_unavailable", styleError); }
}

// The two StyleRunAlignmentType members that exist (measured: #619 F0-1 enumerates exactly these on 30.8.2). Any other value is
// reported as unavailable with its raw name, never replaced by center. A whole-range read of mixed alignment silently returns the
// first character's value (measured), so this is only ever called on one native text run, which splits at an alignment change.
function readAlignmentDetail(attributes) {
  try {
    var alignment = attributes.alignment;
    if (alignment === undefined || alignment === null) throw new Error("characterAttributes.alignment is unavailable.");
    var name = String(alignment);
    if (name === "StyleRunAlignmentType.center") return availableDetail("center");
    if (name === "StyleRunAlignmentType.ROMANBASELINE") return availableDetail("roman_baseline");
    throw new Error("characterAttributes.alignment is an unsupported value: " + name);
  }
  catch (alignmentError) { return unavailableDetail("character_style_unavailable", alignmentError); }
}

// AutoLeadingType has exactly TOPTOTOP and BOTTOMTOBOTTOM (measured: #619 F0-1). Read per paragraph, never for a whole range.
function readLeadingTypeDetail(paragraph) {
  try {
    var paragraphAttributes = paragraph.paragraphAttributes;
    var leadingType = paragraphAttributes.leadingType;
    if (leadingType === undefined || leadingType === null) throw new Error("paragraphAttributes.leadingType is unavailable.");
    var name = String(leadingType);
    if (name === "AutoLeadingType.TOPTOTOP") return availableDetail("top_to_top");
    if (name === "AutoLeadingType.BOTTOMTOBOTTOM") return availableDetail("bottom_to_bottom");
    throw new Error("paragraphAttributes.leadingType is an unsupported value: " + name);
  }
  catch (leadingError) { return unavailableDetail("paragraph_style_unavailable", leadingError); }
}

function readCharacterStyle(character) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) {
    var missing = unavailableDetail("character_style_unavailable", attributesError);
    return {
      font: {
        status: "unavailable", reason: "font_unavailable",
        message: detailErrorMessage(attributesError), fontName: null
      },
      size: missing, tracking: missing, fill: missing, stroke: missing, alignment: missing
    };
  }
  return {
    font: readFontDetail(attributes),
    size: readNumberDetail(attributes, "size"),
    tracking: readNumberDetail(attributes, "tracking"),
    fill: readColorDetail(attributes, "fillColor", "character_style_unavailable"),
    stroke: readColorDetail(attributes, "strokeColor", "character_style_unavailable"),
    alignment: readAlignmentDetail(attributes)
  };
}

function paragraphCollection(items, attempted, total) {
  if (attempted === total) return { status: "complete", items: items };
  return { status: "truncated", items: items, reason: "item_limit", total: total };
}

function scannedCollection(items, total, complete, reason) {
  if (complete) return { status: "complete", items: items };
  if (reason === "item_limit") return { status: "truncated", items: items, reason: reason, total: total };
  return { status: "truncated", items: items, reason: reason, total: null };
}

// on Illustrator 30.8.1 TextRange.getTextRunLength() does not return the run length.
// It returns the absolute (exclusive) end character position of the native style run that contains
// textRange.start, and ignores textRange.end (measured: start=k -> k+1 for 1-character runs,
// start=3/end=4 -> 4, start=3 alone -> 4). The scan loops below assign textRange.start on every
// iteration, so the run length is the distance from the assigned start to that end position.
// Only textRange.start === 0 (the frame's own textRange) has been measured. Whether the returned
// position stays in the same coordinate space when the frame's textRange starts at a non-zero
// story position is unmeasured (the supported read profile); the < 1 check
// fails closed instead of guessing, because both alternative readings (run length, or a position
// relative to the frame start) fall below the assigned start whenever that start is non-zero.
function readNativeTextRunLength(textRange, remainingCharacters) {
  var rangeStart = detailNumber(textRange.start, "TextRange.start");
  var nativeRunEnd = detailNumberInRange(textRange.getTextRunLength(), "TextRange.getTextRunLength()", 1, null);
  if (nativeRunEnd % 1 !== 0) throw new Error("TextRange.getTextRunLength() is not an integer.");
  var runLength = nativeRunEnd - rangeStart;
  if (runLength < 1) {
    throw new Error("TextRange.getTextRunLength() returned " + nativeRunEnd +
      ", which does not extend past the range start " + rangeStart +
      "; the native run end semantics for this range start are unmeasured.");
  }
  return Math.min(runLength, remainingCharacters);
}

// A read that failed inside a text frame, kept as raw evidence for the Node side (reason and guidance are built there). The Illustrator
// error number is the key; the message is localized. An invalid page-item reference is never listed: it always fails the read.
function unreadableEvidence(scope, attribute, index, error) {
  var evidence = hostErrorEvidence(error);
  return { scope: scope, attribute: attribute, index: index, hostErrorNumber: evidence.number, hostErrorName: evidence.name,
    hostMessage: evidence.message === null ? null : truncateUtf16(evidence.message, 200) };
}

// Measured on 30.8.2 (#682 F0): when the contents are empty or end with a carriage return or U+0003, the last paragraph item
// (paragraphs[count-1]) cannot be read (Error 1302 No such element) in every frame kind and place. It is the empty paragraph after the
// trailing break, not an unreadable read.
function isTrailingEmptyParagraphFailure(error, paragraphIndex, paragraphCount, contents) {
  if (paragraphIndex !== paragraphCount - 1 || hostErrorEvidence(error).number !== 1302) return false;
  if (contents.length === 0) return true;
  var last = contents.charCodeAt(contents.length - 1);
  return last === 13 || last === 3;
}

function trailingEmptyParagraph(paragraphIndex) {
  var detail = { status: "unavailable", reason: "trailing_empty_paragraph",
    message: "The empty paragraph after a trailing line break cannot be read by the host; it holds no text." };
  return { index: paragraphIndex, characterCount: 0, preview: "", previewTruncated: false, justification: detail, leadingType: detail };
}

// tolerant: a failed paragraph or text-run read is listed in \`unreadable\` and the rest is still returned. Without it (the default for
// callers that compare or restore state) any failure throws, as before.
function readTextDetails(item, tolerant) {
  var contents = detailString(item.contents, "TextFrame.contents");
  var contentText = truncateUtf16(contents, OBJECT_DETAIL_LIMITS.contentCharacters);
  var paragraphs = [];
  var unreadable = [];
  var paragraphCount = item.paragraphs.length;
  // Up to the paragraph limit of returned paragraphs; an unreadable one does not count toward it (and is listed), so a truncated
  // collection always holds exactly the limit. The loop also stops after 100 unreadable paragraphs (so \`unreadable\` holds at most
  // 101 entries with the style-run one, under its limit of 128); a frame with that many unreadable paragraphs is not expected, and
  // its truncated collection would then hold fewer than the limit.
  var paragraphIndex = 0;
  for (; paragraphIndex < paragraphCount && paragraphs.length < OBJECT_DETAIL_LIMITS.paragraphs &&
      unreadable.length < OBJECT_DETAIL_LIMITS.paragraphs; paragraphIndex++) {
    var paragraph;
    var paragraphText;
    try {
      paragraph = item.paragraphs[paragraphIndex];
      paragraphText = detailString(paragraph.contents, "paragraph.contents");
    } catch (paragraphReadError) {
      if (tolerant !== true || isHostReferenceInvalidError(paragraphReadError)) throw paragraphReadError;
      if (isTrailingEmptyParagraphFailure(paragraphReadError, paragraphIndex, paragraphCount, contents)) {
        paragraphs.push(trailingEmptyParagraph(paragraphIndex));
      } else {
        unreadable.push(unreadableEvidence("paragraph", "paragraphs[" + paragraphIndex + "]", paragraphIndex, paragraphReadError));
      }
      continue;
    }
    var justification;
    try {
      if (paragraph.paragraphAttributes.justification === undefined || paragraph.paragraphAttributes.justification === null) {
        throw new Error("paragraphAttributes.justification is unavailable.");
      }
      justification = availableDetail(String(paragraph.paragraphAttributes.justification));
    }
    catch (paragraphError) { justification = unavailableDetail("paragraph_style_unavailable", paragraphError); }
    paragraphs.push({
      index: paragraphIndex,
      characterCount: paragraphText.length,
      preview: truncateUtf16(paragraphText, OBJECT_DETAIL_LIMITS.paragraphPreviewCharacters),
      previewTruncated: paragraphText.length > OBJECT_DETAIL_LIMITS.paragraphPreviewCharacters,
      justification: justification,
      leadingType: readLeadingTypeDetail(paragraph)
    });
  }

  var textRange = item.textRange;
  var characterCount = detailNumberInRange(textRange.length, "TextFrame.textRange.length", 0, null);
  if (characterCount % 1 !== 0) throw new Error("TextFrame.textRange.length is not an integer.");
  var originalRangeStart = detailNumber(textRange.start, "TextFrame.textRange.start");
  var originalRangeEnd = detailNumber(textRange.end, "TextFrame.textRange.end");
  var scannedCharacterCount = Math.min(characterCount, OBJECT_DETAIL_LIMITS.scannedCharacters);
  var allCharactersScanned = scannedCharacterCount === characterCount;
  var styleRuns = [];
  var styleRunCount = 0;
  var previousStyleKey = null;
  var fontUsages = [];
  var missingFontRanges = [];
  var missingFontRangeCount = 0;
  var activeMissingRange = null;

  function closeMissingRange(end) {
    if (activeMissingRange === null) return;
    missingFontRangeCount++;
    if (missingFontRanges.length < OBJECT_DETAIL_LIMITS.missingFontRanges) {
      activeMissingRange.length = end - activeMissingRange.start;
      missingFontRanges.push(activeMissingRange);
    }
    activeMissingRange = null;
  }

  var scannedRunCount = 0;
  var characterIndex = 0;
  var scanFailed = false;
  try {
    while (characterIndex < scannedCharacterCount && scannedRunCount < OBJECT_DETAIL_LIMITS.scannedTextRuns) {
      textRange.start = originalRangeStart + characterIndex;
      textRange.end = originalRangeStart + scannedCharacterCount;
      var runLength = readNativeTextRunLength(textRange, scannedCharacterCount - characterIndex);
      textRange.end = originalRangeStart + characterIndex + runLength;
      var style = readCharacterStyle(textRange);
      // Compare only the complete reported attributes, including availability diagnostics.
      // Native run boundaries can reflect attributes that this read does not expose.
      var styleKey = stringifyJson(style);
      scannedRunCount++;
      if (styleKey === previousStyleKey) {
        if (styleRunCount <= OBJECT_DETAIL_LIMITS.styleRuns) {
          var previousStyle = styleRuns[styleRuns.length - 1];
          previousStyle.length += runLength;
          previousStyle.mergedCount++;
        }
      } else {
        styleRunCount++;
        if (styleRuns.length < OBJECT_DETAIL_LIMITS.styleRuns) {
          style.start = characterIndex;
          style.length = runLength;
          style.mergedCount = 1;
          styleRuns.push(style);
        }
      }
      previousStyleKey = styleKey;
      if (style.font.status === "available") {
        closeMissingRange(characterIndex);
        var fontKey = style.font.value.postScriptName;
        var usage = null;
        for (var fontIndex = 0; fontIndex < fontUsages.length; fontIndex++) {
          if (fontUsages[fontIndex].key === fontKey) { usage = fontUsages[fontIndex]; break; }
        }
        if (usage === null) {
          usage = {
            key: fontKey,
            family: style.font.value.family,
            style: style.font.value.style,
            postScriptName: style.font.value.postScriptName,
            characterCount: 0
          };
          fontUsages.push(usage);
        }
        usage.characterCount += runLength;
      } else {
        if (activeMissingRange !== null &&
            (activeMissingRange.reason !== style.font.reason || activeMissingRange.fontName !== style.font.fontName ||
             activeMissingRange.message !== style.font.message)) {
          closeMissingRange(characterIndex);
        }
        if (activeMissingRange === null) {
          activeMissingRange = {
            start: characterIndex,
            length: 0,
            reason: style.font.reason,
            message: style.font.message,
            fontName: style.font.fontName
          };
        }
      }
      characterIndex += runLength;
    }
  } catch (scanError) {
    if (tolerant !== true || isHostReferenceInvalidError(scanError)) throw scanError;
    scanFailed = true;
    unreadable.push(unreadableEvidence("style_runs", "getTextRunLength@" + characterIndex, characterIndex, scanError));
  } finally {
    textRange.start = originalRangeStart;
    textRange.end = originalRangeEnd;
  }
  closeMissingRange(characterIndex);

  var returnedFonts = [];
  for (var returnedFontIndex = 0; returnedFontIndex < fontUsages.length && returnedFontIndex < OBJECT_DETAIL_LIMITS.fonts; returnedFontIndex++) {
    returnedFonts.push({
      family: fontUsages[returnedFontIndex].family,
      style: fontUsages[returnedFontIndex].style,
      postScriptName: fontUsages[returnedFontIndex].postScriptName,
      characterCount: fontUsages[returnedFontIndex].characterCount
    });
  }

  var runLimitReached = characterIndex < scannedCharacterCount;
  var allTextRunsScanned = allCharactersScanned && !runLimitReached;
  var incompleteReason = "scan_limit";
  if (scanFailed) incompleteReason = "read_failed";
  else if (runLimitReached) incompleteReason = "run_limit";
  else if (allCharactersScanned) incompleteReason = "item_limit";
  var styleRunsComplete = allTextRunsScanned && styleRunCount <= OBJECT_DETAIL_LIMITS.styleRuns;
  var fontsComplete = allTextRunsScanned && fontUsages.length <= OBJECT_DETAIL_LIMITS.fonts;
  var missingFontsComplete = allTextRunsScanned && missingFontRangeCount <= OBJECT_DETAIL_LIMITS.missingFontRanges;
  var content = contentText.length < contents.length
    ? { status: "truncated", text: contentText, totalCharacters: contents.length }
    : { status: "complete", text: contentText };
  return {
    kind: "text_frame",
    illustratorType: "TextFrame",
    content: content,
    paragraphs: paragraphCollection(paragraphs, paragraphIndex, paragraphCount),
    styleRuns: scannedCollection(
      styleRuns,
      allTextRunsScanned ? styleRunCount : null,
      styleRunsComplete,
      incompleteReason
    ),
    fonts: scannedCollection(
      returnedFonts,
      allTextRunsScanned ? fontUsages.length : null,
      fontsComplete,
      incompleteReason
    ),
    missingFonts: scannedCollection(
      missingFontRanges,
      allTextRunsScanned ? missingFontRangeCount : null,
      missingFontsComplete,
      incompleteReason
    ),
    unreadable: unreadable
  };
}

function readLink(file) {
  var path = detailString(file.fsName, "file.fsName");
  var name = detailString(file.name, "file.name");
  var exists = detailBoolean(file.exists, "file.exists");
  if (!exists) return unavailableDetail("link_file_missing", "The linked file does not exist: " + (name || "unknown"));
  return availableDetail({ path: path, name: name, exists: true });
}

function readLinkedFile(item) {
  try { return readLink(item.file); }
  catch (fileError) { return unavailableDetail("link_file_unavailable", fileError); }
}

function readObjectTypeDetails(item, tolerant) {
  if (item.typename === "TextFrame") return readTextDetails(item, tolerant);
  if (item.typename === "PlacedItem") {
    return {
      kind: "placed_item",
      illustratorType: "PlacedItem",
      state: availableDetail("linked"),
      link: readLinkedFile(item)
    };
  }
  if (item.typename === "RasterItem") {
    var embedded;
    try { embedded = detailBoolean(item.embedded, "embedded"); }
    catch (embeddedError) {
      return {
        kind: "raster_item",
        illustratorType: "RasterItem",
        state: unavailableDetail("link_state_unavailable", embeddedError),
        link: unavailableDetail("link_file_unavailable", "Link state is unavailable.")
      };
    }
    return {
      kind: "raster_item",
      illustratorType: "RasterItem",
      state: availableDetail(embedded ? "embedded" : "linked"),
      link: embedded ? notApplicableDetail("embedded_item") : readLinkedFile(item)
    };
  }
  return { kind: "other", reason: "unsupported_object_type" };
}
`;
export const EXPORT_FONT_SCAN_HELPERS = `
function exportFontScan(doc, limit) {
  var frames = doc.textFrames;
  var total = frames.length;
  var scanned = Math.min(total, limit);
  var names = [];
  var seen = {};
  var incomplete = 0;
  var unreadable = 0;
  function noteName(name) {
    if (typeof name !== "string" || name === "") { unreadable++; return; }
    if (seen["n:" + name] !== true) { seen["n:" + name] = true; names.push(name); }
  }
  for (var frameIndex = 0; frameIndex < scanned; frameIndex++) {
    try {
      var details = readTextDetails(frames[frameIndex], true);
      if (details.fonts.status !== "complete" || details.missingFonts.status !== "complete") incomplete++;
      for (var fontIndex = 0; fontIndex < details.fonts.items.length; fontIndex++) noteName(details.fonts.items[fontIndex].postScriptName);
      for (var missingIndex = 0; missingIndex < details.missingFonts.items.length; missingIndex++) noteName(details.missingFonts.items[missingIndex].fontName);
    } catch (frameError) { unreadable++; }
  }
  return { totalFrames: total, scannedFrames: scanned, limit: limit, incompleteFrames: incomplete, unreadableFrames: unreadable, fontNames: names };
}
`;
export const EXPORT_READ_SOURCE_FONTS_SCRIPT = `${OBJECT_READ_HELPERS}${OBJECT_DETAIL_HELPERS}${EXPORT_FONT_SCAN_HELPERS}${EXPORT_READ_SOURCE_SCRIPT}
result.fontScan = exportFontScan(exportSourceDocument, params.fontScanLimit);
`;
export const SNAPSHOT_DIGEST_HELPERS = `
var SNAPSHOT_SHA256_CONSTANTS = [
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
  3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
  3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
  2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
  666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
  2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
  430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
  1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298
];

function createSnapshotDigest() {
  return {
    state: [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225],
    buffer: [],
    byteCount: 0
  };
}

function snapshotRotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function processSnapshotDigestBlock(digest, block) {
  var words = [];
  var wordIndex;
  for (wordIndex = 0; wordIndex < 16; wordIndex++) {
    var byteIndex = wordIndex * 4;
    words[wordIndex] = ((block[byteIndex] << 24) | (block[byteIndex + 1] << 16) |
      (block[byteIndex + 2] << 8) | block[byteIndex + 3]) >>> 0;
  }
  for (wordIndex = 16; wordIndex < 64; wordIndex++) {
    var previous15 = words[wordIndex - 15];
    var previous2 = words[wordIndex - 2];
    var sigma0 = snapshotRotateRight(previous15, 7) ^ snapshotRotateRight(previous15, 18) ^ (previous15 >>> 3);
    var sigma1 = snapshotRotateRight(previous2, 17) ^ snapshotRotateRight(previous2, 19) ^ (previous2 >>> 10);
    words[wordIndex] = (words[wordIndex - 16] + sigma0 + words[wordIndex - 7] + sigma1) >>> 0;
  }
  var a = digest.state[0], b = digest.state[1], c = digest.state[2], d = digest.state[3];
  var e = digest.state[4], f = digest.state[5], g = digest.state[6], h = digest.state[7];
  for (wordIndex = 0; wordIndex < 64; wordIndex++) {
    var sum1 = snapshotRotateRight(e, 6) ^ snapshotRotateRight(e, 11) ^ snapshotRotateRight(e, 25);
    var choice = (e & f) ^ ((~e) & g);
    var temp1 = (h + sum1 + choice + SNAPSHOT_SHA256_CONSTANTS[wordIndex] + words[wordIndex]) >>> 0;
    var sum0 = snapshotRotateRight(a, 2) ^ snapshotRotateRight(a, 13) ^ snapshotRotateRight(a, 22);
    var majority = (a & b) ^ (a & c) ^ (b & c);
    var temp2 = (sum0 + majority) >>> 0;
    h = g; g = f; f = e; e = (d + temp1) >>> 0;
    d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
  }
  digest.state[0] = (digest.state[0] + a) >>> 0;
  digest.state[1] = (digest.state[1] + b) >>> 0;
  digest.state[2] = (digest.state[2] + c) >>> 0;
  digest.state[3] = (digest.state[3] + d) >>> 0;
  digest.state[4] = (digest.state[4] + e) >>> 0;
  digest.state[5] = (digest.state[5] + f) >>> 0;
  digest.state[6] = (digest.state[6] + g) >>> 0;
  digest.state[7] = (digest.state[7] + h) >>> 0;
}

function appendSnapshotDigestByte(digest, value) {
  digest.buffer.push(value & 255);
  digest.byteCount++;
  if (digest.buffer.length === 64) {
    processSnapshotDigestBlock(digest, digest.buffer);
    digest.buffer = [];
  }
}

function updateSnapshotDigest(digest, value) {
  var framed = String(value.length) + ":" + value + ";";
  for (var digestIndex = 0; digestIndex < framed.length; digestIndex++) {
    var code = framed.charCodeAt(digestIndex);
    if (code >= 55296 && code <= 56319 && digestIndex + 1 < framed.length) {
      var lowSurrogate = framed.charCodeAt(digestIndex + 1);
      if (lowSurrogate >= 56320 && lowSurrogate <= 57343) {
        code = 65536 + ((code - 55296) << 10) + (lowSurrogate - 56320);
        digestIndex++;
      }
    }
    if (code < 128) {
      appendSnapshotDigestByte(digest, code);
    } else if (code < 2048) {
      appendSnapshotDigestByte(digest, 192 | (code >>> 6));
      appendSnapshotDigestByte(digest, 128 | (code & 63));
    } else if (code < 65536) {
      appendSnapshotDigestByte(digest, 224 | (code >>> 12));
      appendSnapshotDigestByte(digest, 128 | ((code >>> 6) & 63));
      appendSnapshotDigestByte(digest, 128 | (code & 63));
    } else {
      appendSnapshotDigestByte(digest, 240 | (code >>> 18));
      appendSnapshotDigestByte(digest, 128 | ((code >>> 12) & 63));
      appendSnapshotDigestByte(digest, 128 | ((code >>> 6) & 63));
      appendSnapshotDigestByte(digest, 128 | (code & 63));
    }
  }
}

function snapshotDigestHex(value) {
  var hex = (value >>> 0).toString(16);
  while (hex.length < 8) hex = "0" + hex;
  return hex;
}

function finishSnapshotDigest(digest) {
  var originalByteCount = digest.byteCount;
  appendSnapshotDigestByte(digest, 128);
  while (digest.buffer.length !== 56) appendSnapshotDigestByte(digest, 0);
  var highBits = Math.floor(originalByteCount / 536870912);
  var lowBits = (originalByteCount << 3) >>> 0;
  appendSnapshotDigestByte(digest, (highBits >>> 24) & 255);
  appendSnapshotDigestByte(digest, (highBits >>> 16) & 255);
  appendSnapshotDigestByte(digest, (highBits >>> 8) & 255);
  appendSnapshotDigestByte(digest, highBits & 255);
  appendSnapshotDigestByte(digest, (lowBits >>> 24) & 255);
  appendSnapshotDigestByte(digest, (lowBits >>> 16) & 255);
  appendSnapshotDigestByte(digest, (lowBits >>> 8) & 255);
  appendSnapshotDigestByte(digest, lowBits & 255);
  var output = "";
  for (var stateIndex = 0; stateIndex < digest.state.length; stateIndex++) {
    output += snapshotDigestHex(digest.state[stateIndex]);
  }
  return output;
}
`;
export const LIST_OBJECTS_SCRIPT = `${OBJECT_READ_HELPERS}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}
var context = requireDocumentForRead(params.expectedDocumentKey);
var doc = app.activeDocument;
var scanStartedAt = new Date().getTime();
var scanTotal = doc.pageItems.length;
var scanVisited = 0;
var scanTicks = 0;
var pageItems = [];
var matchedCount = 0;
var previousUuid = null;
var snapshotWitness = createSnapshotWitness();
var typeWitnesses = {};
walkDocumentTree(doc, function (item, typeName, layerInfo) {
  if (params.filters.type !== null && typeName !== params.filters.type) return;
  if (params.filters.layerPath !== null && !sameNumberArray(layerInfo.path, params.filters.layerPath)) return;
  var bounds = item.geometricBounds;
  if (!boundsMatch(bounds, params.filters.bounds, params.filters.boundsMode)) return;
  var summary = {
    uuid: String(item.uuid),
    type: typeName,
    name: item.name || "",
    layer: { name: layerInfo.name, path: layerInfo.path },
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]]
  };
  if (!typeWitnesses.hasOwnProperty("t:" + typeName)) typeWitnesses["t:" + typeName] = witnessText(typeName);
  addSnapshotWitness(snapshotWitness, summary, layerInfo.witness, typeWitnesses["t:" + typeName], matchedCount);
  if (matchedCount === params.offset - 1) previousUuid = summary.uuid;
  if (matchedCount >= params.offset && pageItems.length < params.limit) pageItems.push(summary);
  matchedCount++;
});
if (scanVisited !== scanTotal) readScanFailure("READ_WALK_INCOMPLETE", { reason: "count_mismatch" });
var result = {
  document: context,
  items: pageItems,
  hasMore: matchedCount > params.offset + pageItems.length,
  snapshotCount: matchedCount,
  previousUuid: previousUuid,
  snapshotDigest: finishSnapshotWitness(snapshotWitness)
};
`;
const OBJECT_LOOKUP_HELPERS = `
function lookupViaNativeUuid(doc, uuid) {
  var startedAt = new Date().getTime();
  var item = null;
  try { item = doc.getPageItemFromUuid(uuid); } catch (lookupError) { item = null; }
  if (item === undefined || item === null) return null;
  var itemUuid = null;
  var typeName = null;
  try { itemUuid = String(item.uuid); typeName = String(item.typename); } catch (readError) { itemUuid = null; }
  if (itemUuid !== uuid) return null;
  if (typeName === "PathItem" || typeName === "TextFrame") return item;
  var siblings = null;
  try {
    var parent = item.parent;
    if (parent.typename === "Layer" || parent.typename === "GroupItem") siblings = parent.pageItems;
    else if (parent.typename === "CompoundPathItem") siblings = parent.pathItems;
  } catch (parentError) { siblings = null; }
  if (siblings === null || siblings === undefined) return null;
  var count = siblings.length;
  for (var siblingIndex = 0; siblingIndex < count; siblingIndex++) {
    if ((siblingIndex & 15) === 0 && new Date().getTime() - startedAt > params.deadlineMs) return null;
    var entry = readPageItemAt("parent.collection", siblingIndex, function () {
      var candidate = siblings[siblingIndex];
      return String(candidate.uuid) === uuid ? candidate : null;
    });
    if (entry !== null) return entry;
  }
  return null;
}

var lookupWalkFound = { walkFound: true };

function lookupViaWalk(doc, uuid) {
  var foundItem = null;
  try {
    walkDocumentTree(doc, function (item) {
      if (String(item.uuid) === uuid) { foundItem = item; throw lookupWalkFound; }
    });
  } catch (walkError) {
    if (walkError !== lookupWalkFound) throw walkError;
    return foundItem;
  }
  if (scanVisited !== scanTotal) readScanFailure("READ_WALK_INCOMPLETE", { reason: "count_mismatch" });
  return null;
}

function lookupPageItem(doc, uuid) {
  var fast = lookupViaNativeUuid(doc, uuid);
  if (fast !== null) return fast;
  scanStartedAt = new Date().getTime();
  scanTotal = doc.pageItems.length;
  scanVisited = 0;
  scanTicks = 0;
  var walked = lookupViaWalk(doc, uuid);
  if (walked === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
  return walked;
}
`;
export const GET_OBJECT_SCRIPT = `${OBJECT_READ_HELPERS}${OBJECT_DETAIL_HELPERS}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${OBJECT_LOOKUP_HELPERS}
var scanStartedAt = 0;
var scanTotal = 0;
var scanVisited = 0;
var scanTicks = 0;
var context = requireDocumentForRead(params.expectedDocumentKey);
var doc = app.activeDocument;
var found = lookupPageItem(doc, params.uuid);
// A read that still fails after the tolerant text reader (the summary, the flags, the contents) is reported with the attribute that
// failed and the Illustrator error number, never as a bare host message. An MCP_ERROR and an invalid reference pass through unchanged.
var readStage = "summary";
var detail = readPageItemAt("lookup", 0, function () {
  try {
    var item = found;
    var layerPath = getLayerPath(doc, item.layer);
    var bounds = item.geometricBounds;
    readStage = "visibleBounds";
    var visibleBounds = item.visibleBounds;
    var summary = summarizePageItem(item, layerPath, bounds);
    summary.visibleBounds = [visibleBounds[0], visibleBounds[1], visibleBounds[2], visibleBounds[3]];
    readStage = "locked";
    summary.locked = detailBoolean(item.locked, "locked");
    readStage = "hidden";
    summary.hidden = detailBoolean(item.hidden, "hidden");
    readStage = "editable";
    summary.editable = detailBoolean(item.editable, "editable");
    readStage = "appearance";
    summary.appearance = readObjectAppearance(item);
    readStage = "details";
    summary.details = readObjectTypeDetails(item, true);
    return summary;
  } catch (readError) {
    if (isHostReferenceInvalidError(readError) || String(readError && readError.message).substring(0, 10) === "MCP_ERROR:") throw readError;
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_ATTRIBUTE_UNREADABLE", attribute: readStage, hostError: hostErrorEvidence(readError) }));
  }
});
var result = { document: context, item: detail };
`;
export const READ_LINE_HEIGHT_SCRIPT = `${OBJECT_READ_HELPERS}${HOST_VERSION_POLICY_JSX}
function lineHeightNumber(value, propertyName) {
  var number = Number(value);
  if (typeof value !== "number" || isNaN(number) || !isFinite(number)) {
    throw new Error(propertyName + " is not an available finite number.");
  }
  return number;
}
function lineHeightUnavailable(reason) { return { status: "unavailable", reason: reason }; }
function readMeasuredFrameLineHeight(frame) {
  if (frame.typename !== "TextFrame" || frame.locked || frame.hidden || !frame.editable ||
      String(frame.orientation) !== "TextOrientation.HORIZONTAL" ||
      (String(frame.kind) !== "TextType.POINTTEXT" && String(frame.kind) !== "TextType.AREATEXT")) {
    return lineHeightUnavailable("unsupported_text_frame_scope");
  }
  try {
    var lineCount = lineHeightNumber(frame.lines.length, "TextFrame.lines.length");
    var paragraphCount = lineHeightNumber(frame.paragraphs.length, "TextFrame.paragraphs.length");
    if (lineCount > ${DESIGN_ANALYSIS_LIMITS.lineHeightLines} || paragraphCount > ${DESIGN_ANALYSIS_LIMITS.lineHeightParagraphs}) {
      return lineHeightUnavailable("line_height_scan_limit");
    }
    if (lineCount < 1 || paragraphCount !== lineCount) return lineHeightUnavailable("line_height_sample_scope_required");
    var rangeStart = lineHeightNumber(frame.textRange.start, "TextFrame.textRange.start");
    var rangeEnd = lineHeightNumber(frame.textRange.end, "TextFrame.textRange.end");
    var previousLineEnd = null;
    var characterCount = 0;
    for (var lineBoundaryIndex = 0; lineBoundaryIndex < lineCount; lineBoundaryIndex++) {
      var boundaryLine = frame.lines[lineBoundaryIndex];
      var lineStart = lineHeightNumber(boundaryLine.start, "Line.start");
      var lineEnd = lineHeightNumber(boundaryLine.end, "Line.end");
      // W164-02 measured "H<ETX>H<ETX>H" as lines [0,1], [2,3], [4,5]: each break character sits between lines.
      var expectedStart = previousLineEnd === null ? rangeStart : previousLineEnd + 1;
      if (lineStart !== expectedStart || lineEnd <= lineStart) return lineHeightUnavailable("line_height_sample_scope_required");
      previousLineEnd = lineEnd;
      characterCount += lineHeightNumber(boundaryLine.characters.length, "Line.characters.length");
    }
    if (previousLineEnd !== rangeEnd) return lineHeightUnavailable("line_height_sample_scope_required");
    if (characterCount > ${DESIGN_ANALYSIS_LIMITS.lineHeightCharacters}) return lineHeightUnavailable("line_height_scan_limit");
    var sampleCharacters = [];
    for (var lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      var line = frame.lines[lineIndex];
      var sample = null;
      var visibleCharacterCount = 0;
      for (var characterIndex = 0; characterIndex < line.characters.length; characterIndex++) {
        var character = line.characters[characterIndex];
        var contents = String(character.contents);
        if (contents !== "\\r" && contents.charCodeAt(0) !== 3) { sample = character; visibleCharacterCount++; }
      }
      if (visibleCharacterCount !== 1) return lineHeightUnavailable("line_height_sample_scope_required");
      sampleCharacters.push(sample);
    }
  } catch (topologyError) { return lineHeightUnavailable("native_property_unavailable"); }
  try {
    var lines = [];
    for (var sampleIndex = 0; sampleIndex < sampleCharacters.length; sampleIndex++) {
      var attributes = sampleCharacters[sampleIndex].characterAttributes;
      if (typeof attributes.autoLeading !== "boolean") throw new Error("characterAttributes.autoLeading is not boolean.");
      lines.push({ sizePt: lineHeightNumber(attributes.size, "characterAttributes.size"),
        leadingPt: lineHeightNumber(attributes.leading, "characterAttributes.leading"), autoLeading: attributes.autoLeading });
    }
    var paragraphAutoLeadingAmounts = [];
    for (var paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex++) {
      paragraphAutoLeadingAmounts.push(lineHeightNumber(frame.paragraphs[paragraphIndex].paragraphAttributes.autoLeadingAmount,
        "paragraphAttributes.autoLeadingAmount"));
    }
    return { status: "available", kind: String(frame.kind), orientation: String(frame.orientation), lines: lines,
      paragraphAutoLeadingAmounts: paragraphAutoLeadingAmounts, observationScope: "complete_frame_single_glyph_lines" };
  } catch (readError) { return lineHeightUnavailable("native_property_unavailable"); }
}
var context = requireDocumentForRead(params.expectedDocumentKey);
var doc = app.activeDocument;
if (!(params.uuids instanceof Array) || params.uuids.length > ${DESIGN_ANALYSIS_LIMITS.textFrameDetailReads}) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "LINE_HEIGHT_TARGET_LIMIT" }));
}
var frameReads = [];
for (var targetIndex = 0; targetIndex < params.uuids.length; targetIndex++) {
  var targetUuid = String(params.uuids[targetIndex]);
  var frame = null;
  for (var itemIndex = 0; itemIndex < doc.pageItems.length; itemIndex++) {
    if (String(doc.pageItems[itemIndex].uuid) === targetUuid) { frame = doc.pageItems[itemIndex]; break; }
  }
  if (frame === null) throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: targetUuid }));
  var frameRead;
  if (hostVersionAdmitted("line_height_read", String(app.version))) frameRead = readMeasuredFrameLineHeight(frame);
  else frameRead = lineHeightUnavailable("unsupported_host_version");
  frameReads.push({ uuid: targetUuid, read: frameRead });
}
var result = { document: requireDocumentForRead(params.expectedDocumentKey), frames: frameReads };
`;
const IMAGE_PREFLIGHT_HELPERS = `
function truncateImageUtf16(value, limit) {
  if (value.length <= limit) return value;
  var end = limit;
  var previous = value.charCodeAt(end - 1);
  var next = value.charCodeAt(end);
  if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--;
  return value.substring(0, end);
}

function imageErrorMessage(error) {
  var raw = error && typeof error.message === "string" && error.message.length > 0
    ? error.message
    : String(error);
  if (raw.length === 0) raw = "Image property is unavailable.";
  return truncateImageUtf16(raw, 500);
}

function unavailableImageProperty(error) {
  return { status: "unavailable", reason: "property_unavailable", message: imageErrorMessage(error) };
}

function readImageProperty(read, validate, label) {
  try {
    var value = read();
    if (!validate(value)) return unavailableImageProperty(label + " is not available in the required type.");
    return { status: "available", value: value };
  } catch (error) { return unavailableImageProperty(error); }
}

function finiteImageNumber(value) { return typeof value === "number" && isFinite(value); }
function positiveImageInteger(value) { return finiteImageNumber(value) && value > 0 && Math.floor(value) === value; }
function imageBoolean(value) { return typeof value === "boolean"; }
function imageRequiredString(value, label, limit) {
  if (typeof value !== "string" || value.length === 0) throw new Error(label + " is unavailable.");
  return truncateImageUtf16(value, limit);
}
function imageCollectionLength(collection, label) {
  var value = collection.length;
  if (!finiteImageNumber(value) || value < 0 || Math.floor(value) !== value) {
    throw new Error(label + ".length is unavailable.");
  }
  return value;
}
function imageBounds(value) {
  return value && typeof value.length === "number" && value.length === 4 &&
    finiteImageNumber(value[0]) && finiteImageNumber(value[1]) &&
    finiteImageNumber(value[2]) && finiteImageNumber(value[3]);
}

function readImageBounds(item) {
  var value = readImageProperty(function () { return item.boundingBox; }, imageBounds, "boundingBox");
  if (value.status === "available") {
    value.value = [value.value[0], value.value[1], value.value[2], value.value[3]];
  }
  return value;
}

function readImageMatrix(item) {
  try {
    var matrix = item.matrix;
    var values = [matrix.mValueA, matrix.mValueB, matrix.mValueC, matrix.mValueD, matrix.mValueTX, matrix.mValueTY];
    for (var index = 0; index < values.length; index++) {
      if (!finiteImageNumber(values[index])) return unavailableImageProperty("matrix contains a non-finite number.");
    }
    return {
      status: "available",
      value: { a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5] }
    };
  } catch (error) { return unavailableImageProperty(error); }
}

function readImageColorants(item) {
  try {
    var source = item.colorants;
    if (!source) return unavailableImageProperty("colorants is unavailable.");
    var sourceLength = imageCollectionLength(source, "colorants");
    if (sourceLength > 64) return unavailableImageProperty("colorants exceeds the supported complete-read limit.");
    var values = [];
    for (var index = 0; index < sourceLength; index++) {
      values.push(truncateImageUtf16(String(source[index]), 500));
    }
    return { status: "available", value: values };
  } catch (error) { return unavailableImageProperty(error); }
}

function readImageEnumString(read, label) {
  try {
    var raw = read();
    if (raw === null || typeof raw === "undefined") {
      return unavailableImageProperty(label + " is unavailable.");
    }
    var value = String(raw);
    if (value.length === 0) return unavailableImageProperty(label + " is unavailable.");
    return { status: "available", value: value };
  } catch (error) { return unavailableImageProperty(error); }
}

function imageLinkage(item) {
  if (item.typename === "PlacedItem") return { status: "available", value: "linked" };
  var embedded = readImageProperty(
    function () { return item.embedded; },
    imageBoolean,
    "embedded"
  );
  return embedded.status === "available"
    ? { status: "available", value: embedded.value ? "embedded" : "linked" }
    : { status: "unavailable", reason: "link_state_unavailable", message: embedded.message };
}

function imageFile(item, linkage) {
  if (linkage.status === "available" && linkage.value === "embedded") {
    return { status: "not_applicable", reason: "embedded_item" };
  }
  if (linkage.status === "unavailable") {
    return { status: "unavailable", reason: "link_file_unavailable", message: linkage.message };
  }
  try {
    var file = item.file;
    var path = typeof file.fsName === "string" ? file.fsName : null;
    var exists = file.exists;
    if (typeof exists !== "boolean") {
      return { status: "unavailable", reason: "link_file_unavailable", message: "file.exists is unavailable." };
    }
    if (!exists) return { status: "missing", path: path, message: "The linked file does not exist." };
    if (path === null || path.length === 0) {
      return { status: "unavailable", reason: "link_file_unavailable", message: "file.fsName is unavailable." };
    }
    return { status: "available", value: { path: path } };
  } catch (error) {
    var number = error && typeof error.number === "number" ? error.number : null;
    if (number === 9062) {
      return { status: "missing", path: null, message: "The linked file is missing and Illustrator did not expose its path." };
    }
    return { status: "unavailable", reason: "link_file_unavailable", message: imageErrorMessage(error) };
  }
}

function imageEffectivePrintState(item, hidden) {
  var visible = !hidden;
  var printable = true;
  var visibleUnknown = false;
  var printableUnknown = false;
  var current = null;
  try { current = item.layer; }
  catch (layerError) { visibleUnknown = true; printableUnknown = true; }
  while (current && current.typename === "Layer") {
    var layerVisible = readImageProperty(function () { return current.visible; }, imageBoolean, "Layer.visible");
    var layerPrintable = readImageProperty(function () { return current.printable; }, imageBoolean, "Layer.printable");
    if (layerVisible.status === "available") {
      if (!layerVisible.value) visible = false;
    } else visibleUnknown = true;
    if (layerPrintable.status === "available") {
      if (!layerPrintable.value) printable = false;
    } else printableUnknown = true;
    try { current = current.parent; }
    catch (parentError) { visibleUnknown = true; printableUnknown = true; current = null; }
  }
  return {
    visible: visible === false ? { status: "available", value: false } :
      (visibleUnknown ? unavailableImageProperty("Effective visibility is unavailable.") : { status: "available", value: true }),
    printable: printable === false ? { status: "available", value: false } :
      (printableUnknown ? unavailableImageProperty("Effective printability is unavailable.") : { status: "available", value: true })
  };
}

function summarizeImageItem(doc, item) {
  var bounds = item.geometricBounds;
  var visibleBounds = item.visibleBounds;
  if (!imageBounds(bounds) || !imageBounds(visibleBounds)) throw new Error("Image PageItem bounds are unavailable.");
  var linkage = imageLinkage(item);
  var locked = readImageProperty(function () { return item.locked; }, imageBoolean, "locked");
  var hidden = readImageProperty(function () { return item.hidden; }, imageBoolean, "hidden");
  if (locked.status !== "available" || hidden.status !== "available") {
    throw new Error("Image PageItem locked/hidden state is unavailable.");
  }
  var printState = imageEffectivePrintState(item, hidden.value);
  var unavailable = unavailableImageProperty("Property is available only for RasterItem.");
  return {
    uuid: imageRequiredString(item.uuid, "PageItem.uuid", 255),
    type: imageRequiredString(item.typename, "PageItem.typename", 255),
    name: typeof item.name === "string" ? truncateImageUtf16(item.name, 500) : "",
    layer: {
      name: typeof item.layer.name === "string" ? truncateImageUtf16(item.layer.name, 500) : "",
      path: getLayerPath(doc, item.layer)
    },
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    visibleBounds: [visibleBounds[0], visibleBounds[1], visibleBounds[2], visibleBounds[3]],
    locked: locked.value,
    hidden: hidden.value,
    effectiveVisible: printState.visible,
    effectivePrintable: printState.printable,
    linkage: linkage,
    file: imageFile(item, linkage),
    intrinsicBounds: readImageBounds(item),
    matrix: readImageMatrix(item),
    raster: item.typename === "RasterItem" ? {
      imageColorSpace: readImageEnumString(function () { return item.imageColorSpace; }, "imageColorSpace"),
      bitsPerChannel: readImageProperty(function () { return item.bitsPerChannel; }, positiveImageInteger, "bitsPerChannel"),
      channels: readImageProperty(function () { return item.channels; }, positiveImageInteger, "channels"),
      colorants: readImageColorants(item)
    } : {
      imageColorSpace: unavailable,
      bitsPerChannel: unavailable,
      channels: unavailable,
      colorants: unavailable
    }
  };
}

function imageSnapshotForDocument(doc, offset, limit, collectPage) {
  var digest = createSnapshotDigest();
  var items = [];
  var count = 0;
  var previousUuid = null;
  var collectionIndex;
  var itemIndex;
  var collections = [doc.placedItems, doc.rasterItems];
  for (collectionIndex = 0; collectionIndex < collections.length; collectionIndex++) {
    var collection = collections[collectionIndex];
    var collectionLength = imageCollectionLength(collection, "image collection");
    for (itemIndex = 0; itemIndex < collectionLength; itemIndex++) {
      var summary = summarizeImageItem(doc, collection[itemIndex]);
      updateSnapshotDigest(digest, stringifyJson(summary));
      if (count === offset - 1) previousUuid = summary.uuid;
      if (collectPage && count >= offset && items.length < limit) items.push(summary);
      count++;
    }
  }
  return {
    items: items,
    snapshotCount: count,
    previousUuid: previousUuid,
    snapshotDigest: finishSnapshotDigest(digest),
    hasMore: count > offset + items.length
  };
}

function findImageByUuid(doc, uuid) {
  var found = null;
  var collections = [doc.placedItems, doc.rasterItems];
  for (var collectionIndex = 0; collectionIndex < collections.length; collectionIndex++) {
    var collection = collections[collectionIndex];
    var collectionLength = imageCollectionLength(collection, "image collection");
    for (var itemIndex = 0; itemIndex < collectionLength; itemIndex++) {
      var candidate = collection[itemIndex];
      if (String(candidate.uuid) !== uuid) continue;
      if (found !== null) throw new Error("Image UUID is not unique in the active document: " + uuid);
      found = candidate;
    }
  }
  if (found !== null) return found;
  var pageItemCount = imageCollectionLength(doc.pageItems, "Document.pageItems");
  for (var pageItemIndex = 0; pageItemIndex < pageItemCount; pageItemIndex++) {
    var pageItem = doc.pageItems[pageItemIndex];
    if (String(pageItem.uuid) === uuid) {
      throw new Error("MCP_ERROR:" + stringifyJson({
        code: "IMAGE_OBJECT_REQUIRED", uuid: uuid, type: String(pageItem.typename)
      }));
    }
  }
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "OBJECT_NOT_FOUND", uuid: uuid }));
}

function imageSnapshotForObjects(doc, uuids) {
  var digest = createSnapshotDigest();
  var items = [];
  for (var index = 0; index < uuids.length; index++) {
    var summary = summarizeImageItem(doc, findImageByUuid(doc, uuids[index]));
    items.push(summary);
    updateSnapshotDigest(digest, stringifyJson(summary));
  }
  return {
    items: items,
    snapshotCount: items.length,
    previousUuid: null,
    snapshotDigest: finishSnapshotDigest(digest),
    hasMore: false
  };
}
`;
export const IMAGE_PREFLIGHT_SCRIPT = `${OBJECT_READ_HELPERS}${SNAPSHOT_DIGEST_HELPERS}${IMAGE_PREFLIGHT_HELPERS}

var context = requireDocumentForRead(params.expectedDocumentKey);
var doc = app.activeDocument;
var first = params.scopeMode === "document"
  ? imageSnapshotForDocument(doc, params.offset, params.limit, true)
  : imageSnapshotForObjects(doc, params.uuids);
var finalContext = requireDocumentForRead(params.expectedDocumentKey);
var second = params.scopeMode === "document"
  ? imageSnapshotForDocument(doc, 0, 0, false)
  : imageSnapshotForObjects(doc, params.uuids);
if (first.snapshotCount !== second.snapshotCount || first.snapshotDigest !== second.snapshotDigest) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "IMAGE_SNAPSHOT_CHANGED" }));
}
var result = {
  document: finalContext,
  items: first.items,
  hasMore: first.hasMore,
  snapshotCount: first.snapshotCount,
  previousUuid: first.previousUuid,
  snapshotDigest: first.snapshotDigest,
  readIntegrity: "verified"
};
`;
export const PRINT_PREFLIGHT_SCRIPT = `${OBJECT_READ_HELPERS}${OBJECT_DETAIL_HELPERS}${SNAPSHOT_DIGEST_HELPERS}${IMAGE_PREFLIGHT_HELPERS}
var PRINT_PREFLIGHT_LIMITS = {
  pageItems: ${PRINT_PREFLIGHT_LIMITS.pageItems},
  findings: ${PRINT_PREFLIGHT_LIMITS.findings}
};

function printString(value, limit) {
  var text = value === null || typeof value === "undefined" ? "" : String(value);
  return truncateUtf16(text, limit);
}

function printProperty(read, validate, message) {
  try {
    var value = read();
    if (!validate(value)) throw new Error(message);
    return { status: "available", value: value };
  } catch (error) {
    return { status: "unavailable", reason: "property_unavailable", message: detailErrorMessage(error) };
  }
}

function printFinite(value) { return typeof value === "number" && isFinite(value); }
function printPositive(value) { return printFinite(value) && value > 0; }
function printStringValue(value) { return typeof value === "string" && value.length > 0; }
function printRequiredString(value, propertyName, limit) {
  if (!printStringValue(value)) throw new Error(propertyName + " is unavailable.");
  return truncateUtf16(value, limit);
}
function printCollectionLength(collection, propertyName, maximum) {
  var value = collection.length;
  if (!printFinite(value) || value < 0 || Math.floor(value) !== value ||
      (maximum !== null && value > maximum)) {
    throw new Error(propertyName + ".length is unavailable or outside the supported range.");
  }
  return value;
}
function printBoolean(value, propertyName) {
  if (typeof value !== "boolean") throw new Error(propertyName + " is unavailable.");
  return value;
}
function printEnum(value, propertyName, allowedValues) {
  if (value === undefined || value === null) throw new Error(propertyName + " is unavailable.");
  var text = String(value);
  if (!printContains(allowedValues, text)) throw new Error(propertyName + " is unavailable or invalid.");
  return text;
}
function printStringArray(value) {
  if (!(value instanceof Array) || value.length > 256) return false;
  for (var index = 0; index < value.length; index++) if (!printStringValue(value[index])) return false;
  return true;
}

var PRINT_BLEND_MODES = [
  "BlendModes.COLORBLEND", "BlendModes.COLORBURN", "BlendModes.COLORDODGE",
  "BlendModes.DARKEN", "BlendModes.DIFFERENCE", "BlendModes.EXCLUSION",
  "BlendModes.HARDLIGHT", "BlendModes.HUE", "BlendModes.LIGHTEN",
  "BlendModes.LUMINOSITY", "BlendModes.MULTIPLY", "BlendModes.NORMAL",
  "BlendModes.OVERLAY", "BlendModes.SATURATIONBLEND", "BlendModes.SCREEN",
  "BlendModes.SOFTLIGHT"
];
var PRINT_INK_TYPES = [
  "InkType.BLACKINK", "InkType.CUSTOMINK", "InkType.CYANINK",
  "InkType.MAGENTAINK", "InkType.YELLOWINK"
];

function printTarget(item) {
  return {
    kind: "object",
    uuid: printRequiredString(item.uuid, "PageItem.uuid", 255),
    type: printRequiredString(item.typename, "PageItem.typename", 255),
    name: printString(item.name || "", 500)
  };
}

function printAddIndeterminate(state, category) {
  for (var index = 0; index < state.indeterminateCategories.length; index++) {
    if (state.indeterminateCategories[index] === category) return;
  }
  state.indeterminateCategories.push(category);
}

function printAddFinding(state, category, code, severity, message, target, actual, expected) {
  state.findingCount++;
  if (!state.collectFindings || state.findings.length >= PRINT_PREFLIGHT_LIMITS.findings) return;
  state.findings.push({
    category: category,
    code: code,
    severity: severity,
    message: truncateUtf16(message, 500),
    target: target,
    actual: actual === null ? null : truncateUtf16(String(actual), 2000),
    expected: expected === null ? null : truncateUtf16(String(expected), 2000)
  });
}

function printContains(value, expected) {
  for (var index = 0; index < value.length; index++) if (value[index] === expected) return true;
  return false;
}

function printColorContainsRgb(color) {
  if (!color || typeof color.model !== "string") return false;
  if (color.model === "rgb") return true;
  if (color.model === "spot") return printColorContainsRgb(color.baseColor);
  if (color.model === "gradient") {
    for (var index = 0; index < color.stops.length; index++) {
      if (printColorContainsRgb(color.stops[index].color)) return true;
    }
  }
  return false;
}

function printColorComplete(color) {
  if (!color || typeof color.model !== "string") return false;
  if (color.model === "none" || color.model === "gray" || color.model === "rgb" ||
      color.model === "cmyk" || color.model === "lab") return true;
  if (color.model === "spot") return printColorComplete(color.baseColor);
  if (color.model === "gradient") {
    for (var index = 0; index < color.stops.length; index++) {
      if (!printColorComplete(color.stops[index].color)) return false;
    }
    return true;
  }
  return false;
}

function printBounds(value) {
  if (!value || value.length !== 4) throw new Error("Bounds are unavailable.");
  var result = [];
  for (var index = 0; index < 4; index++) {
    if (!printFinite(value[index])) throw new Error("Bounds contain a non-finite value.");
    result.push(value[index]);
  }
  return result;
}

function printBoundsRelationship(bounds, artboards) {
  var contained = false;
  var intersects = false;
  // An edge on the artboard edge within the integer tolerance is on it (an artboard edge carries host float noise).
  var slack = ${ARTBOARD_INTEGER_TOLERANCE};
  for (var index = 0; index < artboards.length; index++) {
    var artboard = artboards[index];
    if (bounds[0] >= artboard[0] - slack && bounds[2] <= artboard[2] + slack &&
        bounds[1] <= artboard[1] + slack && bounds[3] >= artboard[3] - slack) contained = true;
    if (bounds[0] <= artboard[2] + slack && bounds[2] >= artboard[0] - slack &&
        bounds[1] >= artboard[3] - slack && bounds[3] <= artboard[1] + slack) intersects = true;
  }
  return contained ? "inside" : (intersects ? "crossing" : "outside");
}

function printLayerState(item) {
  var current = null;
  var visible = true;
  var printable = true;
  var visibleUnknown = false;
  var printableUnknown = false;
  var transparencyUnknown = false;
  var transparency = [];
  var errors = [];
  try { current = item.layer; }
  catch (layerError) {
    errors.push(detailErrorMessage(layerError));
    visibleUnknown = true;
    printableUnknown = true;
    transparencyUnknown = true;
  }
  try { visible = !printBoolean(item.hidden, "PageItem.hidden"); }
  catch (hiddenError) { errors.push(detailErrorMessage(hiddenError)); visibleUnknown = true; }
  while (current && current.typename === "Layer") {
    try { if (!printBoolean(current.visible, "Layer.visible")) visible = false; }
    catch (visibleError) { errors.push(detailErrorMessage(visibleError)); visibleUnknown = true; }
    try { if (!printBoolean(current.printable, "Layer.printable")) printable = false; }
    catch (printableError) { errors.push(detailErrorMessage(printableError)); printableUnknown = true; }
    try {
      var opacity = detailNumberInRange(current.opacity, "Layer.opacity", 0, 100);
      if (opacity < 100) transparency.push("layer opacity " + opacity);
    } catch (opacityError) { errors.push(detailErrorMessage(opacityError)); transparencyUnknown = true; }
    try {
      var blendingMode = printEnum(current.blendingMode, "Layer.blendingMode", PRINT_BLEND_MODES);
      if (blendingMode !== "BlendModes.NORMAL") transparency.push("layer blend " + blendingMode);
    } catch (blendError) { errors.push(detailErrorMessage(blendError)); transparencyUnknown = true; }
    try { current = current.parent; }
    catch (parentError) {
      errors.push(detailErrorMessage(parentError));
      visibleUnknown = true;
      printableUnknown = true;
      transparencyUnknown = true;
      current = null;
    }
  }
  var effectiveVisible = visible === false ? false : (visibleUnknown ? null : true);
  var effectivePrintable = printable === false ? false : (printableUnknown ? null : true);
  return {
    visible: effectiveVisible,
    printable: effectivePrintable,
    transparency: transparency,
    visibilityComplete: effectiveVisible !== null,
    printabilityComplete: effectivePrintable !== null,
    transparencyComplete: !transparencyUnknown,
    complete: errors.length === 0,
    errors: errors
  };
}

function printReadTextPaints(item, context, state, target, record, digest) {
  var textRange = item.textRange;
  var characterCount = detailNumberInRange(textRange.length, "TextFrame.textRange.length", 0, null);
  if (characterCount % 1 !== 0) throw new Error("TextFrame.textRange.length is not an integer.");
  var originalRangeStart = detailNumber(textRange.start, "TextFrame.textRange.start");
  var originalRangeEnd = detailNumber(textRange.end, "TextFrame.textRange.end");
  var scannedCharacters = Math.min(characterCount, OBJECT_DETAIL_LIMITS.scannedCharacters);
  var characterIndex = 0;
  var runCount = 0;
  var paints = [];
  try {
    while (characterIndex < scannedCharacters && runCount < OBJECT_DETAIL_LIMITS.scannedTextRuns) {
      textRange.start = originalRangeStart + characterIndex;
      textRange.end = originalRangeStart + scannedCharacters;
      var runLength = readNativeTextRunLength(textRange, scannedCharacters - characterIndex);
      textRange.end = originalRangeStart + characterIndex + runLength;
      var attributes = textRange.characterAttributes;
      var fill = summarizeColor(attributes.fillColor, 0);
      var stroke = summarizeColor(attributes.strokeColor, 0);
      var strokeWeight = detailNumberInRange(attributes.strokeWeight, "strokeWeight", 0, null);
      var overprintFill = printBoolean(attributes.overprintFill, "CharacterAttributes.overprintFill");
      var overprintStroke = printBoolean(attributes.overprintStroke, "CharacterAttributes.overprintStroke");
      var paint = {
        start: characterIndex,
        length: runLength,
        fill: fill,
        stroke: stroke,
        strokeWeight: strokeWeight,
        overprintFill: overprintFill,
        overprintStroke: overprintStroke
      };
      if (!printColorComplete(fill) || !printColorComplete(stroke)) printAddIndeterminate(state, "color");
      if (paints.length < OBJECT_DETAIL_LIMITS.textPaintRuns) paints.push(paint);
      updateSnapshotDigest(digest, stringifyJson(paint));
      if (context.colorSpace === "CMYK" && (printColorContainsRgb(fill) || printColorContainsRgb(stroke))) {
        printAddFinding(state, "color", "current_vector_rgb_in_cmyk_document", "error",
          "A current text paint is RGB in a CMYK document.", target, "RGB", "current CMYK-compatible paint");
      }
      if (stroke.model !== "none" && strokeWeight < params.conditions.minimumStrokeWidthPt) {
        printAddFinding(state, "stroke", "stroke_below_minimum", "error",
          "Text stroke width is below the required minimum.", target,
          String(strokeWeight) + " pt", ">= " + params.conditions.minimumStrokeWidthPt + " pt");
      }
      var overprints = [];
      if (overprintFill) overprints.push("fill");
      if (overprintStroke) overprints.push("stroke");
      if (overprints.length > 0) {
        printAddFinding(state, "overprint", "overprint_used", params.conditions.allowOverprint ? "info" : "error",
          "Text overprint is enabled.", target, overprints.join(", "),
          params.conditions.allowOverprint ? "overprint allowed" : "no overprint");
      }
      characterIndex += runLength;
      runCount++;
    }
  } finally {
    textRange.start = originalRangeStart;
    textRange.end = originalRangeEnd;
  }
  record.textPaints = paints;
  record.textPaintScan = { characterCount: characterCount, scannedCharacters: characterIndex, runCount: runCount };
  if (characterIndex !== characterCount) {
    printAddIndeterminate(state, "color");
    printAddIndeterminate(state, "stroke");
    printAddIndeterminate(state, "overprint");
    printAddFinding(state, "color", "text_paint_scan_incomplete", "warning",
      "The text paint scan reached a bounded character or run limit.", target,
      String(characterIndex) + " of " + characterCount + " characters", "complete text paint scan");
  }
}

function printReadBleed() {
  return {
    status: "unavailable",
    reason: "current_document_bleed_unavailable",
    message: "Illustrator 30.8.0 exposes bleed on DocumentPreset but not on the current Document DOM."
  };
}

function printReadFacts(doc, context, state) {
  var colorProfileName = printProperty(
    function () { return doc.colorProfileName; },
    printStringValue,
    "colorProfileName is unavailable."
  );
  if (colorProfileName.status === "available") {
    colorProfileName.value = printString(colorProfileName.value, 500);
  }
  if (colorProfileName.status === "unavailable") {
    printAddIndeterminate(state, "color");
    printAddFinding(state, "color", "color_profile_unavailable", "warning",
      colorProfileName.message, { kind: "document" }, colorProfileName.reason, "available color profile");
  }

  var rasterEffectResolution = printProperty(
    function () { return doc.rasterEffectSettings.resolution; },
    function (value) { return printFinite(value) && value >= 72 && value <= 2400; },
    "rasterEffectSettings.resolution is unavailable."
  );
  if (rasterEffectResolution.status === "unavailable") {
    printAddIndeterminate(state, "raster_effect");
    printAddFinding(state, "raster_effect", "raster_effect_settings_unavailable", "warning",
      rasterEffectResolution.message, { kind: "document" }, rasterEffectResolution.reason,
      ">= " + params.conditions.minimumRasterEffectPpi + " ppi");
  } else if (rasterEffectResolution.value < params.conditions.minimumRasterEffectPpi) {
    printAddFinding(state, "raster_effect", "raster_effect_resolution_below_threshold", "error",
      "Document raster-effect resolution is below the required threshold.", { kind: "document" },
      String(rasterEffectResolution.value), ">= " + params.conditions.minimumRasterEffectPpi + " ppi");
  }

  var usedSpotNames;
  try {
    var names = [];
    var inks = doc.inkList;
    var inkCount = printCollectionLength(inks, "Document.inkList", 256);
    for (var inkIndex = 0; inkIndex < inkCount; inkIndex++) {
      var ink = inks[inkIndex];
      var kind = printEnum(ink.inkInfo.kind, "InkInfo.kind", PRINT_INK_TYPES);
      if (kind === "InkType.CUSTOMINK") names.push(printString(ink.name, 500));
    }
    usedSpotNames = printStringArray(names)
      ? { status: "available", value: names }
      : { status: "unavailable", reason: "property_unavailable", message: "inkList is invalid or exceeds 256 used spots." };
  } catch (inkError) {
    usedSpotNames = { status: "unavailable", reason: "property_unavailable", message: detailErrorMessage(inkError) };
  }
  if (usedSpotNames.status === "unavailable") {
    printAddIndeterminate(state, "color");
    printAddFinding(state, "color", "used_ink_list_unavailable", "warning",
      usedSpotNames.message, { kind: "document" }, usedSpotNames.reason, "used ink list available");
  } else {
    for (var spotIndex = 0; spotIndex < usedSpotNames.value.length; spotIndex++) {
      printAddFinding(state, "color", "spot_color_used", params.conditions.allowSpotColors ? "info" : "error",
        "A used custom ink was found in Document.inkList.", { kind: "document" },
        usedSpotNames.value[spotIndex], params.conditions.allowSpotColors ? "spot colors allowed" : "no spot colors");
    }
  }

  if (!printContains(params.conditions.allowedDocumentColorSpaces, context.colorSpace)) {
    printAddFinding(state, "color", "document_color_space_disallowed", "error",
      "The document color space is not allowed by the print conditions.", { kind: "document" },
      context.colorSpace, params.conditions.allowedDocumentColorSpaces.join(", "));
  }

  var bleed = printReadBleed();
  var requiredBleed = params.conditions.requiredBleedPt;
  if (requiredBleed.top > 0 || requiredBleed.right > 0 || requiredBleed.bottom > 0 || requiredBleed.left > 0) {
    printAddIndeterminate(state, "bleed");
    printAddFinding(state, "bleed", "bleed_unavailable", "warning", bleed.message,
      { kind: "document" }, bleed.reason,
      [requiredBleed.top, requiredBleed.right, requiredBleed.bottom, requiredBleed.left].join(", ") + " pt");
  }
  return {
    documentColorSpace: context.colorSpace,
    colorProfileName: colorProfileName,
    rasterEffectResolution: rasterEffectResolution,
    usedSpotNames: usedSpotNames,
    bleed: bleed
  };
}

function printScanDocument(doc, context, collectFindings) {
  var state = {
    collectFindings: collectFindings,
    findings: [],
    findingCount: 0,
    indeterminateCategories: []
  };
  var digest = createSnapshotDigest();
  var facts = printReadFacts(doc, context, state);
  updateSnapshotDigest(digest, stringifyJson(facts));

  var artboards = [];
  var artboardCount = printCollectionLength(doc.artboards, "Document.artboards", null);
  for (var artboardIndex = 0; artboardIndex < artboardCount; artboardIndex++) {
    artboards.push(printBounds(doc.artboards[artboardIndex].artboardRect));
  }
  updateSnapshotDigest(digest, stringifyJson(artboards));

  var totalPageItems = printCollectionLength(doc.pageItems, "Document.pageItems", null);
  var scanCount = Math.min(totalPageItems, PRINT_PREFLIGHT_LIMITS.pageItems);
  for (var itemIndex = 0; itemIndex < scanCount; itemIndex++) {
    var item = doc.pageItems[itemIndex];
    var target = printTarget(item);
    var record = { target: target };
    var bounds = null;
    try { bounds = printBounds(item.geometricBounds); record.bounds = bounds; }
    catch (boundsError) {
      record.boundsError = detailErrorMessage(boundsError);
      printAddIndeterminate(state, "geometry");
    }
    var layerState = printLayerState(item);
    record.layerState = layerState;
    var dependentReadUnavailable = layerState.visible === null ||
      (layerState.visible === true && layerState.printable === null);
    if (dependentReadUnavailable) {
      printAddIndeterminate(state, "layer");
      printAddIndeterminate(state, "geometry");
      printAddIndeterminate(state, "transparency");
      printAddIndeterminate(state, "color");
      printAddIndeterminate(state, "stroke");
      printAddIndeterminate(state, "overprint");
      printAddIndeterminate(state, "font");
    }
    if (!layerState.transparencyComplete && layerState.visible === true && layerState.printable === true) {
      printAddIndeterminate(state, "transparency");
    }
    var itemOpacity = null;
    try { itemOpacity = detailNumberInRange(item.opacity, "opacity", 0, 100); }
    catch (itemOpacityError) {
      record.opacityError = detailErrorMessage(itemOpacityError);
      printAddIndeterminate(state, "transparency");
    }
    var itemBlendingMode = null;
    try { itemBlendingMode = printEnum(item.blendingMode, "PageItem.blendingMode", PRINT_BLEND_MODES); }
    catch (itemBlendError) {
      record.blendingModeError = detailErrorMessage(itemBlendError);
      printAddIndeterminate(state, "transparency");
    }
    record.opacity = itemOpacity;
    record.blendingMode = itemBlendingMode;

    if (layerState.printable === false) {
      printAddFinding(state, "layer", "nonprinting_layer_content", "warning",
        "The object is on a nonprinting layer or under a nonprinting ancestor.", target,
        "effective printable=false", "effective printable=true");
    }
    if (layerState.visible && layerState.printable && bounds !== null) {
      var relationship = printBoundsRelationship(bounds, artboards);
      record.artboardRelationship = relationship;
      if (relationship === "outside") {
        printAddFinding(state, "geometry", "object_outside_artboards", "warning",
          "The printable object is fully outside every artboard.", target, relationship, "inside or crossing");
      } else if (relationship === "crossing") {
        printAddFinding(state, "geometry", "object_crosses_artboard", "info",
          "The printable object crosses an artboard edge.", target, relationship, "review against bleed intent");
      }
    }

    if (layerState.visible && layerState.printable) {
      var transparencySignals = layerState.transparency.slice(0);
      if (itemOpacity !== null && itemOpacity < 100) transparencySignals.push("item opacity " + itemOpacity);
      if (itemBlendingMode !== null && itemBlendingMode !== "BlendModes.NORMAL") {
        transparencySignals.push("item blend " + itemBlendingMode);
      }
      if (transparencySignals.length > 0) {
        printAddFinding(state, "transparency", "transparency_used",
          params.conditions.allowTransparency ? "info" : "error",
          "Transparency or a non-normal blending mode is used.", target,
          transparencySignals.join("; "), params.conditions.allowTransparency ? "transparency allowed" : "no transparency");
      }

      if (item.typename === "PathItem") {
        var appearance = readObjectAppearance(item);
        record.appearance = appearance;
        if (appearance.fill.status === "unavailable") printAddIndeterminate(state, "color");
        if (appearance.stroke.status === "unavailable") {
          printAddIndeterminate(state, "color");
          printAddIndeterminate(state, "stroke");
        }
        var hasRgb = appearance.fill.status === "available" && printColorContainsRgb(appearance.fill.value);
        if (appearance.stroke.status === "available" && printColorContainsRgb(appearance.stroke.value.color)) hasRgb = true;
        if (context.colorSpace === "CMYK" && hasRgb) {
          printAddFinding(state, "color", "current_vector_rgb_in_cmyk_document", "error",
            "A current vector paint is RGB in a CMYK document.", target, "RGB", "current CMYK-compatible paint");
        }
        if ((appearance.fill.status === "available" && !printColorComplete(appearance.fill.value)) ||
            (appearance.stroke.status === "available" && !printColorComplete(appearance.stroke.value.color))) {
          printAddIndeterminate(state, "color");
        }
        if (appearance.stroke.status === "available" && appearance.stroke.value.color.model !== "none" &&
            appearance.stroke.value.width < params.conditions.minimumStrokeWidthPt) {
          printAddFinding(state, "stroke", "stroke_below_minimum", "error",
            "Stroke width is below the required minimum.", target,
            String(appearance.stroke.value.width) + " pt", ">= " + params.conditions.minimumStrokeWidthPt + " pt");
        }
      }

      if (item.typename === "PathItem") {
        var pathOverprints = [];
        try {
          if (printBoolean(item.filled, "PathItem.filled") &&
              printBoolean(item.fillOverprint, "PathItem.fillOverprint")) pathOverprints.push("fill");
        }
        catch (pathFillOverprintError) { printAddIndeterminate(state, "overprint"); record.fillOverprintError = detailErrorMessage(pathFillOverprintError); }
        try {
          if (printBoolean(item.stroked, "PathItem.stroked") &&
              printBoolean(item.strokeOverprint, "PathItem.strokeOverprint")) pathOverprints.push("stroke");
        }
        catch (pathStrokeOverprintError) { printAddIndeterminate(state, "overprint"); record.strokeOverprintError = detailErrorMessage(pathStrokeOverprintError); }
        record.overprints = pathOverprints;
        if (pathOverprints.length > 0) {
          printAddFinding(state, "overprint", "overprint_used", params.conditions.allowOverprint ? "info" : "error",
            "Path overprint is enabled.", target, pathOverprints.join(", "),
            params.conditions.allowOverprint ? "overprint allowed" : "no overprint");
        }
      }

      if (item.typename === "TextFrame") {
        try { printReadTextPaints(item, context, state, target, record, digest); }
        catch (textPaintError) {
          record.textPaintError = detailErrorMessage(textPaintError);
          printAddIndeterminate(state, "color");
          printAddIndeterminate(state, "stroke");
          printAddIndeterminate(state, "overprint");
          printAddFinding(state, "color", "text_paint_scan_incomplete", "warning",
            detailErrorMessage(textPaintError), target, "text paint scan unavailable", "complete text paint scan");
        }
        try {
          var textDetails = readTextDetails(item, true);
          record.fonts = textDetails.fonts;
          record.missingFonts = textDetails.missingFonts;
          if (textDetails.fonts.status !== "complete" || textDetails.missingFonts.status !== "complete") {
            printAddIndeterminate(state, "font");
            printAddFinding(state, "font", "font_scan_incomplete", "warning",
              "The text font scan reached a bounded limit.", target,
              textDetails.missingFonts.reason || textDetails.fonts.reason || "truncated", "complete font scan");
          }
          for (var missingIndex = 0; missingIndex < textDetails.missingFonts.items.length; missingIndex++) {
            var missing = textDetails.missingFonts.items[missingIndex];
            if (missing.reason === "font_missing") {
              printAddFinding(state, "font", "font_missing", "error", missing.message, target,
                missing.fontName || "unknown", "installed font");
            } else {
              printAddIndeterminate(state, "font");
              printAddFinding(state, "font", "font_scan_incomplete", "warning", missing.message, target,
                missing.reason || "font_unavailable", "installed font catalog available");
            }
          }
        } catch (fontError) {
          record.fontError = detailErrorMessage(fontError);
          printAddIndeterminate(state, "font");
          printAddFinding(state, "font", "font_scan_incomplete", "warning",
            detailErrorMessage(fontError), target, "font scan unavailable", "complete font scan");
        }
      }
    }
    updateSnapshotDigest(digest, stringifyJson(record));
  }

  var pageItemsComplete = scanCount === totalPageItems;
  if (!pageItemsComplete) {
    printAddIndeterminate(state, "completeness");
    printAddFinding(state, "completeness", "scan_limit_reached", "warning",
      "The document exceeds the complete PageItem scan limit.", { kind: "document" },
      String(totalPageItems), "<= " + PRINT_PREFLIGHT_LIMITS.pageItems);
  }
  updateSnapshotDigest(digest, String(totalPageItems));
  var imageSnapshot = imageSnapshotForDocument(doc, 0, 0, false);
  return {
    document: context,
    facts: facts,
    scan: {
      totalPageItems: totalPageItems,
      scannedPageItems: scanCount,
      totalImages: imageSnapshot.snapshotCount,
      findingCount: state.findingCount,
      findingsComplete: state.findingCount <= PRINT_PREFLIGHT_LIMITS.findings,
      pageItemsComplete: pageItemsComplete,
      readIntegrity: "verified",
      snapshotDigest: finishSnapshotDigest(digest),
      imageSnapshotDigest: imageSnapshot.snapshotDigest
    },
    findings: state.findings,
    indeterminateCategories: state.indeterminateCategories
  };
}

var initialContext = requireDocumentForRead(params.expectedDocumentKey);
var printDocument = app.activeDocument;
var firstPrintScan = printScanDocument(printDocument, initialContext, params.collectFindings === true);
var finalContext = requireDocumentForRead(params.expectedDocumentKey);
var secondPrintScan = printScanDocument(printDocument, finalContext, false);
if (firstPrintScan.scan.snapshotDigest !== secondPrintScan.scan.snapshotDigest ||
    firstPrintScan.scan.imageSnapshotDigest !== secondPrintScan.scan.imageSnapshotDigest ||
    firstPrintScan.scan.totalPageItems !== secondPrintScan.scan.totalPageItems ||
    firstPrintScan.scan.totalImages !== secondPrintScan.scan.totalImages) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "PRINT_PREFLIGHT_SNAPSHOT_CHANGED" }));
}
firstPrintScan.document = finalContext;
var result = firstPrintScan;
`;
export const CLIP_FLAGS_SCRIPT = `${OBJECT_DETAIL_HELPERS}
function clipAvailability(read) {
  try { return availableDetail(read()); }
  catch (readError) { return unavailableDetail("clip_state_unavailable", readError); }
}
var clipContext = requireDocumentForRead(params.expectedDocumentKey);
var clipDocument = app.activeDocument;
var clipTotal = clipDocument.pageItems.length;
if (clipTotal > ${STRUCTURE_SNAPSHOT_LIMITS.pageItems}) {
  throw new Error("MCP_ERROR:" + stringifyJson({
    code: "STRUCTURE_SNAPSHOT_TOO_LARGE", collection: "pageItems", total: clipTotal, limit: ${STRUCTURE_SNAPSHOT_LIMITS.pageItems}
  }));
}
var clipItems = [];
for (var clipIndex = 0; clipIndex < clipTotal; clipIndex++) {
  var clipItem = clipDocument.pageItems[clipIndex];
  var clipRecord = { uuid: String(clipItem.uuid), type: String(clipItem.typename), clipping: null, clipped: null };
  if (clipRecord.type === "PathItem") {
    clipRecord.clipping = clipAvailability(function () { return detailBoolean(clipItem.clipping, "clipping"); });
  }
  if (clipRecord.type === "GroupItem") {
    clipRecord.clipped = clipAvailability(function () { return detailBoolean(clipItem.clipped, "clipped"); });
  }
  clipItems.push(clipRecord);
}
var result = { document: requireDocumentForRead(params.expectedDocumentKey), totalPageItems: clipTotal, items: clipItems };
`;
const STRUCTURE_HELPERS = `
var STRUCTURE_SNAPSHOT_LIMITS = {
  pageItems: ${STRUCTURE_SNAPSHOT_LIMITS.pageItems},
  artboards: ${STRUCTURE_SNAPSHOT_LIMITS.artboards},
  textCharacters: ${STRUCTURE_SNAPSHOT_LIMITS.textCharacters}
};
var STRUCTURE_PAGE_LIMITS = {
  budgetBytes: ${STRUCTURE_PAGE_LIMITS.budgetBytes},
  maxPages: ${STRUCTURE_PAGE_LIMITS.maxPages}
};

function structureAvailability(read, unavailableReason) {
  try { return availableDetail(read()); }
  catch (readError) { return unavailableDetail(unavailableReason, readError); }
}

function structureBounds(value, propertyName) {
  if (!value || value.length !== 4) throw new Error(propertyName + " is unavailable.");
  var bounds = [];
  for (var boundsIndex = 0; boundsIndex < 4; boundsIndex++) {
    bounds.push(detailNumber(value[boundsIndex], propertyName + "[" + boundsIndex + "]"));
  }
  return bounds;
}

function structureParent(item) {
  var parent = item.parent;
  if (!parent) throw new Error("PageItem.parent is unavailable.");
  var parentType = detailString(parent.typename, "parent.typename");
  if (parentType === "Layer") return { kind: "layer" };
  var parentUuid = parent.uuid;
  if (parentUuid === undefined || parentUuid === null || String(parentUuid) === "") {
    throw new Error("parent.uuid is unavailable.");
  }
  return { kind: "page_item", uuid: String(parentUuid), type: parentType };
}

function structureText(item) {
  var contents = detailString(item.contents, "TextFrame.contents");
  var text = truncateUtf16(contents, STRUCTURE_SNAPSHOT_LIMITS.textCharacters);
  return { text: text, totalCharacters: contents.length, truncated: text.length < contents.length };
}

/** UTF-8 size of the serialized record: the durable result record is bounded in bytes, not code units. */
function structureUtf8Bytes(value) {
  var bytes = 0;
  for (var byteIndex = 0; byteIndex < value.length; byteIndex++) {
    var code = value.charCodeAt(byteIndex);
    if (code >= 55296 && code <= 56319 && byteIndex + 1 < value.length) {
      var lowSurrogate = value.charCodeAt(byteIndex + 1);
      if (lowSurrogate >= 56320 && lowSurrogate <= 57343) { bytes += 4; byteIndex++; continue; }
    }
    if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

function structureLimits(doc) {
  var totalPageItems = doc.pageItems.length;
  var declaredLimit = STRUCTURE_SNAPSHOT_LIMITS.pageItems;
  if (params.maxPageItems !== undefined && params.maxPageItems !== null && params.maxPageItems < declaredLimit) {
    declaredLimit = params.maxPageItems;
  }
  if (totalPageItems > declaredLimit) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "STRUCTURE_SNAPSHOT_TOO_LARGE", collection: "pageItems",
      total: totalPageItems, limit: declaredLimit
    }));
  }
  var artboardCount = doc.artboards.length;
  if (artboardCount > STRUCTURE_SNAPSHOT_LIMITS.artboards) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "STRUCTURE_SNAPSHOT_TOO_LARGE", collection: "artboards",
      total: artboardCount, limit: STRUCTURE_SNAPSHOT_LIMITS.artboards
    }));
  }
  return { totalPageItems: totalPageItems, artboardCount: artboardCount };
}

function structureArtboards(doc, artboardCount) {
  var artboards = [];
  for (var artboardIndex = 0; artboardIndex < artboardCount; artboardIndex++) {
    var artboard = doc.artboards[artboardIndex];
    artboards.push({
      index: artboardIndex,
      name: artboard.name || "",
      bounds: structureBounds(artboard.artboardRect, "artboardRect")
    });
  }
  return artboards;
}

/** Native UUID to document position, so a parent can be named by order instead of by an identity a copy changes. */
function structureIndexByUuid(doc, totalPageItems) {
  var indexByUuid = {};
  for (var uuidIndex = 0; uuidIndex < totalPageItems; uuidIndex++) {
    var uuidValue = readPageItemAt("document.pageItems", uuidIndex, function () { return doc.pageItems[uuidIndex].uuid; });
    if (uuidValue !== undefined && uuidValue !== null) indexByUuid["u" + String(uuidValue)] = uuidIndex;
  }
  return indexByUuid;
}

function structureItemRecord(doc, itemIndex) {
  return readPageItemAt("document.pageItems", itemIndex, function () { return structureItemRecordAt(doc, itemIndex); });
}

function structureItemRecordAt(doc, itemIndex) {
  return structureRecordOfItem(doc, doc.pageItems[itemIndex], itemIndex);
}

/** The canonical record of one item reference; \`position\` is its documentIndex (a position in the walk or in doc.pageItems). */
function structureRecordOfItem(doc, item, itemIndex) {
  var layerPath = getLayerPath(doc, item.layer);
  var record = summarizePageItem(item, layerPath, structureBounds(item.geometricBounds, "geometricBounds"));
  record.visibleBounds = structureBounds(item.visibleBounds, "visibleBounds");
  record.documentIndex = itemIndex;
  record.parent = structureAvailability(function () { return structureParent(item); }, "parent_unavailable");
  record.locked = structureAvailability(function () { return detailBoolean(item.locked, "locked"); }, "lock_state_unavailable");
  record.hidden = structureAvailability(function () { return detailBoolean(item.hidden, "hidden"); }, "hidden_state_unavailable");
  record.appearance = readObjectAppearance(item);
  record.text = item.typename === "TextFrame"
    ? structureAvailability(function () { return structureText(item); }, "text_unavailable")
    : null;
  var areaText = structureAreaTextLayout(item);
  if (areaText !== null) record.areaText = areaText;
  return record;
}

/**
 * An area TextFrame with more than one column: the restore comparison also compares its frame matrix, the text path's
 * closed flag and points, the area options, the content, the paragraph alignment and the character style runs, on top
 * of every field it compares for any item (visibleBounds included). Measured on 30.8.2: writing the area options does
 * not mark the document changed, so a saved document can hold columns its file does not; this is what shows it. An
 * area frame's textPath.geometricBounds is undefined (error 21), so the text path is read part by part and each part
 * is kept as available or unavailable with the reason. Any other item, or a frame whose other reads fail, gets nothing.
 */
function structureAreaTextLayout(item) {
  if (item.typename !== "TextFrame") return null;
  try {
    if (String(item.kind) !== "TextType.AREATEXT" || !(Number(item.columnCount) > 1)) return null;
    var matrix = item.matrix;
    var details = readTextDetails(item);
    return {
      matrix: [detailNumber(matrix.mValueA, "matrix.a"), detailNumber(matrix.mValueB, "matrix.b"), detailNumber(matrix.mValueC, "matrix.c"),
        detailNumber(matrix.mValueD, "matrix.d"), detailNumber(matrix.mValueTX, "matrix.tx"), detailNumber(matrix.mValueTY, "matrix.ty")],
      textPath: {
        closed: structureAvailability(function () { return detailBoolean(item.textPath.closed, "textPath.closed"); }, "text_path_unavailable"),
        points: structureAvailability(function () { return structureTextPathPoints(item.textPath); }, "text_path_unavailable")
      },
      options: {
        columnCount: detailNumber(item.columnCount, "columnCount"), columnGutter: detailNumber(item.columnGutter, "columnGutter"),
        rowCount: detailNumber(item.rowCount, "rowCount"), rowGutter: detailNumber(item.rowGutter, "rowGutter"),
        flowLinksHorizontally: detailBoolean(item.flowLinksHorizontally, "flowLinksHorizontally")
      },
      content: details.content,
      paragraphs: details.paragraphs,
      styleRuns: details.styleRuns
    };
  } catch (_layoutError) {
    return null;
  }
}

function structureTextPathPoints(path) {
  var points = [];
  for (var pointIndex = 0; pointIndex < path.pathPoints.length; pointIndex++) {
    var point = path.pathPoints[pointIndex];
    points.push({ anchor: structurePair(point.anchor, "anchor"), leftDirection: structurePair(point.leftDirection, "leftDirection"),
      rightDirection: structurePair(point.rightDirection, "rightDirection") });
  }
  return points;
}

function structurePair(value, propertyName) {
  if (!value || value.length !== 2) throw new Error(propertyName + " is unavailable.");
  return [detailNumber(value[0], propertyName + "[0]"), detailNumber(value[1], propertyName + "[1]")];
}

/** Exactly the projection comparableItem() compares: no native UUID, parent named by document position. */
function structureComparableRecord(record, indexByUuid) {
  var parent = record.parent;
  if (parent && parent.status === "available" && parent.value && parent.value.kind === "page_item") {
    var mapped = indexByUuid["u" + parent.value.uuid];
    parent = {
      status: "available",
      value: { kind: "page_item", type: parent.value.type, documentIndex: mapped === undefined ? null : mapped }
    };
  }
  if (record.areaText !== undefined) {
    return {
      type: record.type, name: record.name, layer: record.layer, bounds: record.bounds,
      visibleBounds: record.visibleBounds, documentIndex: record.documentIndex, parent: parent,
      locked: record.locked, hidden: record.hidden, appearance: record.appearance, text: record.text, areaText: record.areaText
    };
  }
  return {
    type: record.type, name: record.name, layer: record.layer, bounds: record.bounds,
    visibleBounds: record.visibleBounds, documentIndex: record.documentIndex, parent: parent,
    locked: record.locked, hidden: record.hidden, appearance: record.appearance, text: record.text
  };
}

/** Greedy byte-budgeted partition: one page never exceeds the budget, and one record never spans two pages. */
function createStructurePagePlan() {
  return { pages: [], current: null };
}

/**
 * The transported serialization sizes the page (the durable result record carries the full records); the
 * comparable serialization is what the page digest covers, so the same digest can be compared across two
 * documents whose native UUIDs legitimately differ.
 */
function structurePlanAdd(plan, collection, offset, transported, comparable, uuid) {
  var bytes = structureUtf8Bytes(transported) + 1;
  if (bytes > STRUCTURE_PAGE_LIMITS.budgetBytes) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "STRUCTURE_PAGE_PLAN_TOO_LARGE", reason: "record_too_large",
      collection: collection, offset: offset, bytes: bytes, limit: STRUCTURE_PAGE_LIMITS.budgetBytes,
      uuid: uuid === undefined ? null : uuid
    }));
  }
  var current = plan.current;
  if (current === null || current.collection !== collection ||
      current.bytes + bytes > STRUCTURE_PAGE_LIMITS.budgetBytes) {
    // Reject before retaining a record for a page outside the existing transport budget.
    if (plan.pages.length >= STRUCTURE_PAGE_LIMITS.maxPages) {
      throw new Error("MCP_ERROR:" + stringifyJson({
        code: "STRUCTURE_PAGE_PLAN_TOO_LARGE", reason: "too_many_pages",
        pages: plan.pages.length + 1, limit: STRUCTURE_PAGE_LIMITS.maxPages
      }));
    }
    current = { index: plan.pages.length, collection: collection, offset: offset, count: 0, bytes: 0,
      digestState: createSnapshotDigest() };
    plan.pages.push(current);
    plan.current = current;
  }
  current.count++;
  current.bytes += bytes;
  updateSnapshotDigest(current.digestState, comparable);
}

function structurePlanFinish(plan) {
  if (plan.pages.length > STRUCTURE_PAGE_LIMITS.maxPages) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "STRUCTURE_PAGE_PLAN_TOO_LARGE", reason: "too_many_pages",
      pages: plan.pages.length, limit: STRUCTURE_PAGE_LIMITS.maxPages
    }));
  }
  var entries = [];
  for (var pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
    var page = plan.pages[pageIndex];
    entries.push({ index: page.index, collection: page.collection, offset: page.offset,
      count: page.count, bytes: page.bytes, digest: finishSnapshotDigest(page.digestState) });
  }
  return entries;
}

/**
 * The comparable digest rolls up the page digests instead of digesting every canonical record a second time:
 * the partition is a function of the records' own sizes, so two documents that agree on every canonical
 * record also agree on the partition and therefore on the roll-up. A partition that does disagree only makes
 * the caller pay for the tolerant comparison; it can never report agreement that is not there.
 */
function structureDigestScan(doc, context, verification) {
  var limits = structureLimits(doc);
  var artboards = structureArtboards(doc, limits.artboardCount);
  var indexByUuid = structureIndexByUuid(doc, limits.totalPageItems);
  var digest = createSnapshotDigest();
  var plan = createStructurePagePlan();
  verification.artboards = stringifyJson(artboards);
  updateSnapshotDigest(digest, verification.artboards);
  for (var artboardIndex = 0; artboardIndex < artboards.length; artboardIndex++) {
    var artboardSerialized = stringifyJson(artboards[artboardIndex]);
    structurePlanAdd(plan, "artboards", artboardIndex, artboardSerialized, artboardSerialized);
  }
  for (var itemIndex = 0; itemIndex < limits.totalPageItems; itemIndex++) {
    var record = structureItemRecord(doc, itemIndex);
    var serialized = stringifyJson(record);
    updateSnapshotDigest(digest, serialized);
    var comparableSerialized = stringifyJson(structureComparableRecord(record, indexByUuid));
    structurePlanAdd(plan, "pageItems", itemIndex, serialized, comparableSerialized, record.uuid);
    verification.transported.push(serialized);
    verification.comparable.push(comparableSerialized);
  }
  updateSnapshotDigest(digest, String(limits.totalPageItems));
  var pages = structurePlanFinish(plan);
  var comparable = createSnapshotDigest();
  updateSnapshotDigest(comparable, stringifyJson({ colorSpace: context.colorSpace, artboardCount: context.artboardCount }));
  for (var pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    updateSnapshotDigest(comparable, stringifyJson({
      collection: pages[pageIndex].collection, offset: pages[pageIndex].offset,
      count: pages[pageIndex].count, digest: pages[pageIndex].digest
    }));
  }
  updateSnapshotDigest(comparable, String(limits.totalPageItems));
  return {
    document: context,
    scan: {
      totalPageItems: limits.totalPageItems,
      artboardCount: limits.artboardCount,
      readIntegrity: "verified",
      snapshotDigest: finishSnapshotDigest(digest),
      comparableDigest: finishSnapshotDigest(comparable)
    },
    pages: pages
  };
}

/** Repeat the same observations, comparing exact SHA inputs without hashing them again. */
function structureVerifyScan(doc, context, first, verification) {
  var limits = structureLimits(doc);
  if (limits.totalPageItems !== first.scan.totalPageItems || limits.artboardCount !== first.scan.artboardCount ||
      context.colorSpace !== first.document.colorSpace || context.artboardCount !== first.document.artboardCount) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_SNAPSHOT_CHANGED" }));
  }
  var artboards = structureArtboards(doc, limits.artboardCount);
  var indexByUuid = structureIndexByUuid(doc, limits.totalPageItems);
  if (stringifyJson(artboards) !== verification.artboards) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_SNAPSHOT_CHANGED" }));
  }
  for (var itemIndex = 0; itemIndex < limits.totalPageItems; itemIndex++) {
    var record = structureItemRecord(doc, itemIndex);
    if (stringifyJson(record) !== verification.transported[itemIndex] ||
        stringifyJson(structureComparableRecord(record, indexByUuid)) !== verification.comparable[itemIndex]) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_SNAPSHOT_CHANGED" }));
    }
  }
}

function structurePageScan(doc, context) {
  var limits = structureLimits(doc);
  var offset = params.offset;
  var count = params.count;
  if (params.collection !== "artboards" && params.collection !== "pageItems") {
    throw new Error("Unsupported structure page collection.");
  }
  var total = params.collection === "artboards" ? limits.artboardCount : limits.totalPageItems;
  if (offset < 0 || count < 0 || offset + count > total) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_SNAPSHOT_CHANGED" }));
  }
  var digest = createSnapshotDigest();
  var artboards = [];
  var items = [];
  if (params.collection === "artboards") {
    var allArtboards = structureArtboards(doc, limits.artboardCount);
    for (var artboardIndex = offset; artboardIndex < offset + count; artboardIndex++) {
      artboards.push(allArtboards[artboardIndex]);
      updateSnapshotDigest(digest, stringifyJson(allArtboards[artboardIndex]));
    }
  } else {
    var indexByUuid = structureIndexByUuid(doc, limits.totalPageItems);
    for (var itemIndex = offset; itemIndex < offset + count; itemIndex++) {
      var record = structureItemRecord(doc, itemIndex);
      items.push(record);
      updateSnapshotDigest(digest, stringifyJson(structureComparableRecord(record, indexByUuid)));
    }
  }
  return {
    document: context,
    collection: params.collection,
    offset: offset,
    count: count,
    totalPageItems: limits.totalPageItems,
    artboardCount: limits.artboardCount,
    digest: finishSnapshotDigest(digest),
    artboards: artboards,
    items: items
  };
}
`;
export const CAPTURE_STRUCTURE_SNAPSHOT_SCRIPT = `${OBJECT_READ_HELPERS}${OBJECT_DETAIL_HELPERS}${SNAPSHOT_DIGEST_HELPERS}${STRUCTURE_HELPERS}
var structureInitialContext = requireDocumentForRead(params.expectedDocumentKey);
var structureDocument = app.activeDocument;
var result;
if (params.mode === "page") {
  result = structurePageScan(structureDocument, structureInitialContext);
  result.document = requireDocumentForRead(params.expectedDocumentKey);
} else {
  // Call-local only: never return or reuse these strings across host calls.
  var structureVerification = { artboards: "", transported: [], comparable: [] };
  var firstStructureScan = structureDigestScan(structureDocument, structureInitialContext, structureVerification);
  var structureFinalContext = requireDocumentForRead(params.expectedDocumentKey);
  structureVerifyScan(structureDocument, structureFinalContext, firstStructureScan, structureVerification);
  structureVerification = null;
  firstStructureScan.document = structureFinalContext;
  result = firstStructureScan;
}
`;
export const CAPTURE_STRUCTURE_STREAM_SCRIPT = `${OBJECT_READ_HELPERS}${OBJECT_DETAIL_HELPERS}${OBJECT_WITNESS_HELPERS}${OBJECT_WALK_HELPERS}${STRUCTURE_HELPERS}
var streamContext = requireDocumentForRead(params.expectedDocumentKey);
var streamDoc = app.activeDocument;
var scanStartedAt = new Date().getTime();
var scanTotal = streamDoc.pageItems.length;
var scanVisited = 0;
var scanTicks = 0;
var streamBudgetStop = { streamBudgetStop: true };
var streamFile = new File(params.spoolPath);
streamFile.encoding = "UTF-8";
streamFile.lineFeed = "Unix";
if (!streamFile.open("w")) throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_STREAM_FILE_UNWRITABLE", error: String(streamFile.error) }));
// A UTF-8 File.write of a string holding a surrogate can fail and write nothing (measured: U+E0100), so every surrogate code
// unit is written as a JSON unicode escape, as the command records are (jsonFileText in the runtime). The JSON value is
// unchanged, and the counts below are those of the text actually written. Almost every line has none: one test decides.
var streamSurrogatePattern = /[\\uD800-\\uDFFF]/;
function streamLine(text) { return streamSurrogatePattern.test(text) ? jsonFileText(text) : text; }
// The only File.write of this script: a failed write stops the call (File.error is read before close() clears it).
function streamWrite(text) {
  var written = streamFile.write(text);
  var writeError = String(streamFile.error);
  if (written !== true || writeError !== "") throw new Error("MCP_ERROR:" + stringifyJson({ code: "STRUCTURE_STREAM_WRITE_FAILED", error: writeError }));
}
// The same bytes as stringifyJson, faster: a string with nothing to escape (almost every key and value of a record) is
// returned between quotes without visiting its characters one by one. Measured: serialization was most of a pass.
var streamEscapePattern = /[\\u0000-\\u001f"\\\\]/;
function streamJson(value) {
  if (value === null || value === undefined) return "null";
  var type = typeof value;
  if (type === "number" || type === "boolean") return String(value);
  if (type === "string") return streamEscapePattern.test(value) ? stringifyJson(value) : '"' + value + '"';
  if (value instanceof Array) {
    var arrayParts = [];
    for (var i = 0; i < value.length; i++) arrayParts.push(streamJson(value[i]));
    return "[" + arrayParts.join(",") + "]";
  }
  var objectParts = [];
  for (var key in value) {
    if (value.hasOwnProperty(key)) objectParts.push(streamJson(key) + ":" + streamJson(value[key]));
  }
  return "{" + objectParts.join(",") + "}";
}
var streamLines = 0;
var streamChars = 0;
var streamBuffer = [];
var streamDone = false;
function streamFlush() {
  if (streamBuffer.length === 0) return;
  streamWrite(streamBuffer.join("\\n") + "\\n");
  streamBuffer = [];
}
try {
  var streamArtboardCount = streamDoc.artboards.length;
  streamWrite(streamLine(stringifyJson({ h: 1, key: streamContext.key, pageItems: scanTotal, artboards: streamArtboardCount, saved: streamContext.saved, position: params.position })) + "\\n");
  if (params.position === 0) streamWrite(streamLine(stringifyJson({ a: structureArtboards(streamDoc, streamArtboardCount) })) + "\\n");
  try {
    walkDocumentTree(streamDoc, function (item, typeName, layerInfo) {
      var position = scanVisited - 1;
      if (position < params.position) return;
      if (new Date().getTime() - scanStartedAt > params.budgetMs) throw streamBudgetStop;
      var line = streamLine(streamJson(structureRecordOfItem(streamDoc, item, position)));
      streamBuffer.push(line);
      streamChars += line.length + 1;
      streamLines++;
      if (streamBuffer.length >= 200) streamFlush();
    });
    streamDone = true;
  } catch (walkStop) {
    if (walkStop !== streamBudgetStop) throw walkStop;
  }
  streamFlush();
  if (streamDone && scanVisited !== scanTotal) readScanFailure("READ_WALK_INCOMPLETE", { reason: "count_mismatch" });
  streamWrite(stringifyJson({ t: 1, done: streamDone, lines: streamLines, chars: streamChars, position: params.position + streamLines }) + "\\n");
} finally {
  streamFile.close();
}
var result = {
  done: streamDone,
  lines: streamLines,
  chars: streamChars,
  position: params.position + streamLines,
  document: requireDocumentForRead(params.expectedDocumentKey)
};
`;
function validateImagePreflightCursor(value) {
    try {
        const candidate = value;
        if (candidate.version !== 1 || candidate.kind !== 'image_preflight' ||
            typeof candidate.documentKey !== 'string' || candidate.documentKey.length < 1 || candidate.documentKey.length > 16_384 ||
            typeof candidate.minimumEffectivePpi !== 'number' || !Number.isFinite(candidate.minimumEffectivePpi) ||
            candidate.minimumEffectivePpi <= 0 || candidate.minimumEffectivePpi > 100_000 ||
            !Number.isSafeInteger(candidate.offset) || (candidate.offset ?? 0) < 1 ||
            typeof candidate.previousUuid !== 'string' || candidate.previousUuid.length < 1 || candidate.previousUuid.length > 255 ||
            typeof candidate.snapshotDigest !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.snapshotDigest) ||
            !Number.isSafeInteger(candidate.snapshotCount) || (candidate.snapshotCount ?? 0) < 1) {
            throw new Error('invalid');
        }
        return candidate;
    }
    catch {
        throw new InvalidCursorError('The image-preflight cursor is invalid for this request.');
    }
}
const STRUCTURE_STREAM_BUDGET_MS = 10_000;
const STRUCTURE_STREAM_DEADLINE_MS = 20_000;
export const READ_SCAN_DEADLINE_MS = 12_000;
function readScanLimitError(detail) {
    if (detail?.code === 'READ_SCAN_DEADLINE') {
        return new ReadScanLimitError('READ_SCAN_DEADLINE', `The read stopped after ${detail.elapsedMs ?? '?'} ms (limit ${detail.deadlineMs ?? READ_SCAN_DEADLINE_MS} ms) having scanned ${detail.scanned ?? '?'} of ${detail.total ?? '?'} page items: ` +
            'the document is too large for one scan. Nothing was changed and no command is left running. Read specific objects with illustrator_get_object, or illustrator_list_selection.');
    }
    if (detail?.code === 'READ_WALK_INCOMPLETE') {
        return new ReadScanLimitError('READ_WALK_INCOMPLETE', `The read reached ${detail.scanned ?? '?'} of ${detail.total ?? '?'} page items (${detail.reason ?? 'unknown reason'}) and refused to return a partial list as complete. ` +
            'Nothing was changed.');
    }
    return null;
}
function validateCursorPayload(value) {
    const earlier = value;
    if (typeof earlier === 'object' && earlier !== null && earlier.version === 1 && earlier.kind === undefined && earlier.snapshotCount !== undefined) {
        throw new StaleCursorError('The object-list cursor was issued before the listing order changed to layer-tree order; list again from the start.');
    }
    try {
        const candidate = value;
        const filters = candidate.filters;
        const validLayerPath = filters?.layerPath === null || (Array.isArray(filters?.layerPath) &&
            filters.layerPath.length > 0 && filters.layerPath.length <= 64 &&
            filters.layerPath.every((part) => Number.isInteger(part) && part >= 0));
        const validBounds = filters?.bounds === null || (Array.isArray(filters?.bounds) && filters.bounds.length === 4 &&
            filters.bounds.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
            filters.bounds[0] <= filters.bounds[2] && filters.bounds[1] >= filters.bounds[3]);
        const validFilters = filters !== undefined &&
            (filters.type === null || (typeof filters.type === 'string' && filters.type.length >= 1 && filters.type.length <= 255)) &&
            validLayerPath && validBounds &&
            (filters.boundsMode === 'intersects' || filters.boundsMode === 'contained');
        if (candidate.version !== 2 || typeof candidate.documentKey !== 'string' ||
            !Number.isInteger(candidate.offset) || (candidate.offset ?? 0) < 1 ||
            typeof candidate.previousUuid !== 'string' || candidate.previousUuid.length < 1 || candidate.previousUuid.length > 255 ||
            typeof candidate.snapshotDigest !== 'string' || !/^[a-f0-9]{32,64}$/.test(candidate.snapshotDigest) ||
            !Number.isInteger(candidate.snapshotCount) || (candidate.snapshotCount ?? 0) < 1 ||
            !validFilters) {
            throw new Error('Invalid cursor payload.');
        }
        return candidate;
    }
    catch (_error) {
        throw new InvalidCursorError();
    }
}
function sameFilters(left, right) {
    const sameArray = (first, second) => first === null || second === null
        ? first === second
        : first.length === second.length && first.every((value, index) => value === second[index]);
    return left.type === right.type && left.boundsMode === right.boundsMode &&
        sameArray(left.layerPath, right.layerPath) && sameArray(left.bounds, right.bounds);
}
function artboardRectsOf(artboards) {
    return artboards.map((artboard) => artboard.rect.join(',')).join(';');
}
function exportSessionPaths(session) {
    return [session.workCopyPath, session.stagedPath, session.outputPath];
}
async function syncDirectory(path) {
    const handle = await open(path, directoryFlags());
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
function deleteLockRefusal(error) {
    if (!(error instanceof IndeterminateExecutionError) || !error.message.startsWith('Illustrator is reserved by command '))
        return null;
    return `Illustrator is reserved by command ${error.commandId ?? 'unknown'}; nothing was read or closed. If it is the indeterminate delete, check with illustrator_reconcile (action inspect) and, once it reports canReleaseUnverified, release it with action release_unverified and confirm_command_id; then run illustrator_reconcile_delete again.`;
}
export function parseMcpError(error) {
    if (typeof error !== 'object' || error === null || !('message' in error) ||
        typeof error.message !== 'string')
        return null;
    const raw = error.message.startsWith('MCP_ERROR:')
        ? error.message.slice('MCP_ERROR:'.length)
        : error.message;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return null;
    return parsed;
}
const PRE_APPLY_FALLBACK_AUDIT_MESSAGES = new Set(['Preflight failed.', 'Planning failed.']);
function preApplyRefusalError(error, adapter) {
    if (error.audit === null)
        return error;
    const detail = (error.hostMessage === null ? null : parseMcpError({ message: error.hostMessage })) ??
        parseMcpError({ message: error.audit.message });
    let reason = null;
    const hostReference = error.hostMessage === null ? null : hostReferenceInvalidDetail(error.hostMessage);
    if (hostReference !== null) {
        reason = hostReferenceInvalidReason(hostReference);
    }
    else if (detail?.code === 'DOCUMENT_MISMATCH') {
        reason = new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '').message;
    }
    else if (adapter !== null && typeof detail?.code === 'string') {
        const mapped = adapter.mapExecutionError(error, detail);
        if (mapped.message !== error.message)
            reason = mapped.message;
    }
    if (reason === null && detail === null && !PRE_APPLY_FALLBACK_AUDIT_MESSAGES.has(error.audit.message)) {
        reason = error.audit.message;
    }
    return new ProvenPreApplyFailureError(error.commandId, error.hostMessage, error.audit, {
        phase: error.audit.phase,
        reasonCode: typeof detail?.code === 'string' ? detail.code : `${error.audit.phase}_failed`,
        reason,
    });
}
export const LIST_LAYERS_SCRIPT = `
var context = getDocumentContext();
var doc = app.activeDocument;
var activeLayer = doc.activeLayer;
var layerCount = 0;

function readLayerCollection(collection, parentPath, ancestorVisible, ancestorLocked, ancestorPrintable) {
  var nodes = [];
  for (var layerIndex = 0; layerIndex < collection.length; layerIndex++) {
    var layer = collection[layerIndex];
    var path = parentPath.concat([layerIndex]);
    var visible = layer.visible === true;
    var locked = layer.locked === true;
    var printable = layer.printable === true;
    var effectiveVisible = ancestorVisible && visible;
    var effectiveLocked = ancestorLocked || locked;
    var effectivePrintable = ancestorPrintable && printable;
    var blockedReasons = [];
    if (!visible) blockedReasons.push("layer_hidden");
    if (!ancestorVisible) blockedReasons.push("ancestor_hidden");
    if (locked) blockedReasons.push("layer_locked");
    if (ancestorLocked) blockedReasons.push("ancestor_locked");
    layerCount++;
    nodes.push({
      index: layerIndex,
      path: path,
      name: layer.name || "",
      zOrderPosition: layer.zOrderPosition,
      active: layer === activeLayer,
      visible: visible,
      locked: locked,
      printable: printable,
      preview: layer.preview === true,
      dimPlacedImages: layer.dimPlacedImages === true,
      effectiveVisible: effectiveVisible,
      effectiveLocked: effectiveLocked,
      effectivePrintable: effectivePrintable,
      templateState: "unknown",
      editable: blockedReasons.length === 0,
      editabilityBlockedReasons: blockedReasons,
      layers: readLayerCollection(layer.layers, path, effectiveVisible, effectiveLocked, effectivePrintable)
    });
  }
  return nodes;
}

var result = {
  document: context,
  complete: true,
  layerCount: 0,
  layers: readLayerCollection(doc.layers, [], true, false, true)
};
result.layerCount = layerCount;
`;
export const LIST_DOCUMENTS_SCRIPT = `
// Windows exposes read-only Application properties as global names in standalone JSX.
// Never assign to "documents": it can remain the native Documents collection rather than an Array.
var listedActiveDocument = app.documents.length > 0 ? app.activeDocument : null;
var documentEntries = [];
for (var documentIndex = 0; documentIndex < app.documents.length; documentIndex++) {
  var doc = app.documents[documentIndex];
  var identity = getDocumentIdentity(doc, documentIndex);
  var activeArtboardIndex = doc.artboards.getActiveArtboardIndex();
  var artboards = [];
  for (var artboardIndex = 0; artboardIndex < doc.artboards.length; artboardIndex++) {
    var artboard = doc.artboards[artboardIndex];
    var bounds = artboard.artboardRect;
    artboards.push({
      index: artboardIndex,
      name: artboard.name || "",
      bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
      active: artboardIndex === activeArtboardIndex
    });
  }
  documentEntries.push({
    keyVersion: identity.keyVersion,
    key: identity.key,
    keyShort: identity.keyShort,
    index: documentIndex,
    name: identity.name,
    path: identity.path,
    fileRevision: identity.fileRevision,
    saved: identity.saved,
    colorSpace: identity.colorSpace,
    active: doc === listedActiveDocument,
    artboards: artboards
  });
}
var result = {
  complete: true,
  coordinateSpace: "illustrator_document",
  unit: "pt",
  appVersion: app.version,
  documentCount: documentEntries.length,
  documents: documentEntries
};
`;
export const LIST_SWATCHES_SCRIPT = `
var SWATCH_READ_LIMITS = { swatches: 512, gradientStops: 32, messageCharacters: 500 };
var context = requireDocumentForRead(params.expectedDocumentKey);
var doc = app.activeDocument;
var swatchCount = doc.swatches.length;
if (swatchCount > SWATCH_READ_LIMITS.swatches) {
  throw new Error("Swatch count exceeds the complete-read limit of " + SWATCH_READ_LIMITS.swatches + ".");
}

function swatchTruncateUtf16(value, limit) {
  if (value.length <= limit) return value;
  var end = limit;
  if (end > 0) {
    var previous = value.charCodeAt(end - 1);
    var next = value.charCodeAt(end);
    if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--;
  }
  return value.substring(0, end);
}

function swatchErrorMessage(error) {
  var message = error && error.message ? String(error.message) : String(error);
  return swatchTruncateUtf16(message, SWATCH_READ_LIMITS.messageCharacters);
}

function swatchString(value, propertyName) {
  if (typeof value !== "string") throw new Error(propertyName + " is not an available string.");
  return value;
}

function swatchNumberInRange(value, propertyName, minimum, maximum) {
  if (typeof value !== "number" || isNaN(value) || !isFinite(value) || value < minimum || value > maximum) {
    throw new Error(propertyName + " is outside the supported range " + minimum + ".." + maximum + ".");
  }
  return value;
}

function summarizeSwatchProcessColor(color, allowNone) {
  if (color === null || color === undefined) throw new Error("Color is unavailable.");
  var typename = swatchString(color.typename, "color.typename");
  if (typename === "NoColor" && allowNone) return { model: "none" };
  if (typename === "GrayColor") return {
    model: "gray", gray: swatchNumberInRange(color.gray, "gray", 0, 100)
  };
  if (typename === "RGBColor") return {
    model: "rgb",
    red: swatchNumberInRange(color.red, "red", 0, 255),
    green: swatchNumberInRange(color.green, "green", 0, 255),
    blue: swatchNumberInRange(color.blue, "blue", 0, 255)
  };
  if (typename === "CMYKColor") return {
    model: "cmyk",
    cyan: swatchNumberInRange(color.cyan, "cyan", 0, 100),
    magenta: swatchNumberInRange(color.magenta, "magenta", 0, 100),
    yellow: swatchNumberInRange(color.yellow, "yellow", 0, 100),
    black: swatchNumberInRange(color.black, "black", 0, 100)
  };
  if (typename === "LabColor") return {
    model: "lab",
    lightness: swatchNumberInRange(color.l, "lightness", -128, 128),
    a: swatchNumberInRange(color.a, "a", -128, 128),
    b: swatchNumberInRange(color.b, "b", -128, 128)
  };
  throw new Error(typename + " is not a supported process color.");
}

function summarizeSwatchSpotColor(color) {
  if (!color.spot) throw new Error("spot is unavailable.");
  var colorTypeValue = String(color.spot.colorType);
  var colorType = colorTypeValue === "ColorModel.SPOT" ? "spot" :
    (colorTypeValue === "ColorModel.REGISTRATION" ? "registration" : "unknown");
  return {
    model: "spot",
    name: swatchString(color.spot.name, "spot.name"),
    tint: swatchNumberInRange(color.tint, "tint", 0, 100),
    colorType: colorType,
    baseColor: summarizeSwatchProcessColor(color.spot.color, true)
  };
}

function summarizeSwatchStopColor(color) {
  if (color && color.typename === "SpotColor") return summarizeSwatchSpotColor(color);
  return summarizeSwatchProcessColor(color, false);
}

function summarizeSwatchColor(color) {
  if (color === null || color === undefined) throw new Error("Color is unavailable.");
  var typename = swatchString(color.typename, "color.typename");
  if (typename === "SpotColor") return summarizeSwatchSpotColor(color);
  if (typename === "GradientColor") {
    if (!color.gradient) throw new Error("gradient is unavailable.");
    var gradientTypeValue = String(color.gradient.type);
    var gradientType = gradientTypeValue === "GradientType.LINEAR" ? "linear" :
      (gradientTypeValue === "GradientType.RADIAL" ? "radial" : null);
    if (gradientType === null) throw new Error("gradient.type is unsupported.");
    var stopCount = color.gradient.gradientStops.length;
    if (stopCount < 2 || stopCount > SWATCH_READ_LIMITS.gradientStops) {
      throw new Error("gradient stop count is outside 2.." + SWATCH_READ_LIMITS.gradientStops + ".");
    }
    var stops = [];
    for (var stopIndex = 0; stopIndex < stopCount; stopIndex++) {
      var stop = color.gradient.gradientStops[stopIndex];
      stops.push({
        rampPoint: swatchNumberInRange(stop.rampPoint, "gradientStop.rampPoint", 0, 100),
        midPoint: swatchNumberInRange(stop.midPoint, "gradientStop.midPoint", 13, 87),
        opacity: swatchNumberInRange(stop.opacity, "gradientStop.opacity", 0, 100),
        color: summarizeSwatchStopColor(stop.color)
      });
    }
    return {
      model: "gradient",
      name: swatchString(color.gradient.name, "gradient.name"),
      type: gradientType,
      stops: stops
    };
  }
  if (typename === "PatternColor") {
    if (!color.pattern) throw new Error("pattern is unavailable.");
    return { model: "pattern", name: swatchString(color.pattern.name, "pattern.name") };
  }
  try { return summarizeSwatchProcessColor(color, true); }
  catch (processColorError) {
    if (typename === "NoColor" || typename === "GrayColor" || typename === "RGBColor" ||
        typename === "CMYKColor" || typename === "LabColor") throw processColorError;
    return { model: "unknown", typename: typename };
  }
}

var swatches = [];
for (var swatchIndex = 0; swatchIndex < swatchCount; swatchIndex++) {
  var swatch = doc.swatches[swatchIndex];
  var color;
  try {
    color = { status: "available", value: summarizeSwatchColor(swatch.color) };
  } catch (colorError) {
    color = {
      status: "unavailable",
      reason: "color_unavailable",
      message: swatchErrorMessage(colorError)
    };
  }
  swatches.push({
    index: swatchIndex,
    name: swatchString(swatch.name, "swatch.name"),
    color: color
  });
}

var result = {
  document: context,
  complete: true,
  swatchCount: swatchCount,
  swatches: swatches
};
`;
const LIST_SELECTION_SCRIPT = `
var context = getDocumentContext();
var selection = app.activeDocument.selection;
var items = [];
if (selection && selection.length) {
  for (var i = 0; i < selection.length; i++) {
    var item = selection[i];
    var bounds = item.geometricBounds;
    items.push({
      uuid: item.uuid,
      type: item.typename,
      name: item.name || "",
      bounds: [bounds[0], bounds[1], bounds[2], bounds[3]]
    });
  }
}
var result = { document: context, items: items };
`;
function lifecycleMismatchMessage(detail) {
    if (detail.code === 'DOCUMENT_KEY_AMBIGUOUS')
        return 'The short document key matches more than one open document; pass the full key.';
    return `The active document key does not match expected_document_key (${detail.actual === undefined ? 'unknown' : String(detail.actual)}).`;
}
function lifecycleDetailMessage(detail) {
    if (typeof detail.message === 'string' && detail.message.length > 0)
        return detail.message;
    return `${detail.code ?? 'host error'}${detail.path === undefined ? '' : `: ${detail.path}`}${detail.actual === undefined ? '' : ` (actual ${String(detail.actual)})`}`;
}
export class PostHostConformanceError extends Error {
    commandId;
    hostTerminalState;
    constructor(commandId, hostTerminalState, cause) {
        const detail = cause instanceof ZodError ? summarizeValidationFailure(cause) : cause instanceof Error ? cause.message : String(cause);
        super(`Illustrator finished command ${commandId} as "${hostTerminalState}", but the server could not confirm ` +
            `that result against the approved plan: ${detail} The document may already contain this change; ` +
            'inspect the document before retrying and do not re-run the operation with a new command_id.', { cause });
        this.commandId = commandId;
        this.hostTerminalState = hostTerminalState;
        this.name = 'PostHostConformanceError';
    }
}
class EditSessionChangedDuringSaveError extends Error {
    constructor() {
        super('The edit session of this file changed before the save could start; nothing was written. Re-read the session with illustrator_get_edit_session.');
        this.name = 'EditSessionChangedDuringSaveError';
    }
}
class EditSessionOpenRejectedError extends Error {
    result;
    constructor(result) {
        super(result.message);
        this.result = result;
        this.name = 'EditSessionOpenRejectedError';
    }
}
class EditSessionSaveYield extends Error {
}
export class IllustratorOperationsCore {
    bridge;
    cursorSigner;
    mutationAdapters;
    recipeAuthorityStore;
    imageFileInspector;
    backupStore;
    recipeStore;
    exportStore;
    hostProfileProbe;
    recipeExecutionAuthorityStore;
    fontVerifier;
    fontInventory;
    hostApplicationActivator;
    imagePreflightBatchGate;
    #operationSafetyRegistry = new OperationSafetyRegistry();
    #structureSnapshots = new StructureSnapshotStore();
    #structureDiffs = new StructureDiffStore();
    #leaseGuard;
    #saveAs;
    #editSessions;
    #openScans;
    #saveScans;
    #scanTiming;
    #renderSets = new RenderSetStore();
    constructor(bridge, cursorSigner = new CursorSigner(), mutationAdapters = defaultMutationOperationRegistry(), recipeAuthorityStore = new M6P0RecipeAuthorityStore(defaultStateRoot()), imageFileInspector = new SipsImageFileInspector(), backupStore = new DocumentBackupStore(defaultStateRoot()), recipeStore = new RecipeStore(defaultStateRoot()), exportStore = new DocumentExportStore(defaultStateRoot()), hostProfileProbe = new OsascriptHostProfileProbe(), recipeExecutionAuthorityStore = new RecipeExecutionAuthorityStore(defaultStateRoot()), editSessionStore = null, saveAsRegistry = null, fontVerifier = new SystemFontVerifier(), editSessionScanClock = Date.now, scanTiming = {}, fontInventory = new IllustratorFontInventory(), hostApplicationActivator = null, imagePreflightBatchGate) {
        this.bridge = bridge;
        this.cursorSigner = cursorSigner;
        this.mutationAdapters = mutationAdapters;
        this.recipeAuthorityStore = recipeAuthorityStore;
        this.imageFileInspector = imageFileInspector;
        this.backupStore = backupStore;
        this.recipeStore = recipeStore;
        this.exportStore = exportStore;
        this.hostProfileProbe = hostProfileProbe;
        this.recipeExecutionAuthorityStore = recipeExecutionAuthorityStore;
        this.fontVerifier = fontVerifier;
        this.fontInventory = fontInventory;
        this.hostApplicationActivator = hostApplicationActivator;
        this.imagePreflightBatchGate = imagePreflightBatchGate;
        if (!this.mutationAdapters.isSealed()) {
            throw new Error('Illustrator operations require a sealed mutation adapter registry.');
        }
        this.#openScans = new EditSessionOpenScans(editSessionScanClock);
        this.#saveScans = new EditSessionOpenScans(editSessionScanClock);
        this.#scanTiming = editSessionScanTiming(scanTiming);
        this.#saveAs = saveAsRegistry ?? new SaveAsLeaseRegistry(new SaveAsSessionStore(this.exportStore.stateRootPath));
        this.#leaseGuard = new LeaseGuard(this.backupStore, this.exportStore, this.#saveAs);
        this.#editSessions = new EditSessionCoordinator(editSessionStore ?? new EditSessionStore(defaultStateRoot(), this.#leaseGuard));
        this.bridge.setMutationTerminalObserver?.(this.#editSessions);
        for (const adapter of this.mutationAdapters.list())
            this.#operationSafetyRegistry.register(adapter.safety);
    }
    getMutationAdapterRegistry() {
        return this.mutationAdapters;
    }
    describeApplication(version) {
        const target = this.bridge.applicationTarget?.() ?? null;
        return { bundleId: target?.bundleId ?? null, version, channel: target?.channel ?? 'unknown' };
    }
    async getContext() {
        const result = await this.executeHost({ kind: 'read', script: GET_CONTEXT_SCRIPT, hostGate: this.editSessionHostGate(false, false, undefined, true, { source: 'context' }) });
        return { ...result.data, application: this.describeApplication(result.data.appVersion) };
    }
    async executeHost(command) {
        const barriers = this.bridge.releaseBarrierStore?.() ?? null;
        if (barriers !== null && command.script !== CREATE_DOCUMENT_SCRIPT && command.script !== CLOSE_DOCUMENT_SCRIPT) {
            const gate = command.hostGate;
            command = { ...command, hostGate: { ...gate, beforeHost: async (context) => {
                        const admission = await gate?.beforeHost?.(context);
                        if (admission?.dirtyFileAdmission !== undefined)
                            return admission;
                        return { ...admission, dirtyFileAdmission: await buildDirtyFileAdmission(barriers, this.#editSessions.store, false) };
                    } } };
        }
        if (command.kind !== 'read' || ![LIST_DOCUMENTS_SCRIPT, FIND_FONTS_SCRIPT, FIND_FONTS_QUERY_SCRIPT].includes(command.script)) {
            return await this.bridge.execute(withFilePathComparisons(command));
        }
        const target = this.bridge.applicationTarget?.() ?? null;
        const binding = await this.fontInventory.captureBinding(target);
        if (binding === null || await this.observeEditSessionHostProfile() !== 'foreground_unlocked') {
            return await this.bridge.execute(withFilePathComparisons(command));
        }
        const unwrap = (data) => {
            if (data === null || typeof data !== 'object' || !Object.hasOwn(data, 'mcpCleanFontInventory') || !Object.hasOwn(data, 'mcpFontReadValue')) {
                throw new Error('FONT_INVENTORY_RESPONSE_INVALID');
            }
            return { inventory: data.mcpCleanFontInventory,
                value: data.mcpFontReadValue };
        };
        try {
            const result = await this.bridge.execute(withFilePathComparisons({ ...command, kind: 'read',
                script: CAPTURE_CLEAN_FONT_INVENTORY_SCRIPT + command.script + '\nresult = { mcpCleanFontInventory: mcpCleanFontInventory, mcpFontReadValue: result };',
                hostGate: {
                    beforeHost: async (context) => {
                        const admission = await command.hostGate?.beforeHost?.(context);
                        await this.fontInventory.assertBinding(binding, target);
                        if (await this.observeEditSessionHostProfile() !== 'foreground_unlocked')
                            throw new Error('FONT_INVENTORY_FOREGROUND_REQUIRED');
                        return admission;
                    },
                    afterHost: async (context) => {
                        const data = unwrap(context.data);
                        await this.fontInventory.assertBinding(binding, target);
                        if (await this.observeEditSessionHostProfile() !== 'foreground_unlocked')
                            throw new Error('FONT_INVENTORY_FOREGROUND_REQUIRED');
                        await command.hostGate?.afterHost?.({ ...context, data: data.value });
                        this.fontInventory.accept(binding, data.inventory);
                    },
                },
            }));
            return { ...result, data: unwrap(result.data).value };
        }
        catch (error) {
            this.fontInventory.clear();
            throw error;
        }
    }
    async createDocument(input) {
        const result = await this.executeHost({
            kind: 'read',
            script: CREATE_DOCUMENT_SCRIPT,
            params: {
                colorSpace: input.colorSpace,
                widthPt: input.widthPt,
                heightPt: input.heightPt,
                ...(input.artboardName === undefined ? {} : { artboardName: input.artboardName }),
            },
            timeoutMs: CREATE_DOCUMENT_HOST_TIMEOUT_MS,
            hostGate: { beforeHost: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); } },
        });
        const data = result.data;
        if (data.outcome !== 'created')
            return data;
        const bounds = data.document.activeArtboardBounds;
        return {
            ...data,
            document: {
                ...data.document,
                activeArtboardBounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
                application: this.describeApplication(data.document.appVersion),
            },
        };
    }
    async readLifecycleDocument(expectedDocumentKey, inspectItemCount = false) {
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: LIFECYCLE_READ_SCRIPT,
                params: { expectedDocumentKey, ...(inspectItemCount ? { inspectItemCount: true } : {}) },
                hostGate: { beforeHost: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); } },
            });
            return { read: result.data };
        }
        catch (error) {
            if (error instanceof IndeterminateExecutionError)
                return { indeterminate: error };
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH' || detail?.code === 'DOCUMENT_KEY_AMBIGUOUS') {
                return { rejected: { reason: 'document_key_mismatch', message: lifecycleMismatchMessage(detail) } };
            }
            throw error;
        }
    }
    async saveSessionIdentityForDocument(document) {
        if (document.path === null || document.fileRevision === null || document.fileRevision === '')
            return { state: 'unproven', reason: 'document_file_unavailable' };
        try {
            const candidate = await this.#editSessions.store.findActiveForPath(document.path);
            if (candidate.state !== 'valid')
                return { state: 'unproven', reason: candidate.state === 'invalid' ? candidate.reason : 'no_session' };
            return await proveSaveSessionIdentity(candidate.record, { path: document.path, fileRevision: document.fileRevision });
        }
        catch (error) {
            return { state: 'unproven', reason: error instanceof Error ? error.message : String(error) };
        }
    }
    async saveDocumentAs(input) {
        let stage = 'read_document';
        let document = null;
        const files = { stagedPath: null, outputPath: null };
        let pendingId = null;
        const pending = () => (pendingId === null ? {} : {
            saveAsId: pendingId, nextCall: { tool: 'illustrator_reconcile_save_as', arguments: { save_as_id: pendingId } },
        });
        let lastMessage = '';
        const indeterminate = (message, commandId = null) => {
            lastMessage = message;
            return { outcome: 'indeterminate', stage, message, commandId, document, path: files.outputPath ?? files.stagedPath, files: { ...files }, ...pending() };
        };
        const rejected = (reason, message) => ({ outcome: 'rejected', reason, message, document });
        const describe = (error) => (error instanceof Error ? error.message : String(error));
        const preflight = await this.readLifecycleDocument(input.expectedDocumentKey);
        if ('indeterminate' in preflight)
            return indeterminate(preflight.indeterminate.message, preflight.indeterminate.commandId);
        if ('rejected' in preflight)
            return rejected(preflight.rejected.reason, preflight.rejected.message);
        document = preflight.read.document;
        if (document.path === null)
            return rejected('document_not_admitted', document.mutationBlockedReason ?? 'The document path could not be read; save-as is refused.');
        const barredEarly = await saveBarrierRefusal(this.bridge.releaseBarrierStore?.() ?? null, document, { prepare: false, ownPathOnly: true });
        if (barredEarly !== null)
            return rejected('document_not_admitted', barredEarly);
        stage = 'validate_path';
        let previousRealPath = null;
        let previousFacts = null;
        if (document.fileRevision !== null) {
            try {
                previousRealPath = await realpath(document.path);
                previousFacts = await readFileFacts(previousRealPath);
            }
            catch (error) {
                return rejected('document_not_admitted', `The current document file could not be inspected: ${describe(error)}`);
            }
        }
        let output;
        try {
            output = await validateOutputPath(input.outputPath, 'ai', previousRealPath ?? '', this.exportStore.stateRootPath);
        }
        catch (error) {
            if (error instanceof ExportPreconditionError)
                return rejected(error.reason === 'output_exists' ? 'output_exists' : 'output_path_invalid', error.message);
            throw error;
        }
        const outputPath = output.path;
        const owner = await this.#saveAs.owner();
        if (owner === null) {
            return rejected('owner_identity_unavailable', 'The boot session or start time of this MCP server process could not be read, so the save-as could not be recorded durably; nothing was saved.');
        }
        const store = this.#saveAs.store;
        const saveAsId = newSaveAsId();
        const stagingDirectory = join(output.parent, `${SAVE_AS_STAGING_PREFIX}${saveAsId}`);
        const stagedPath = join(stagingDirectory, basename(outputPath));
        let lease = null;
        let leaseLost = false;
        const assertOwnLease = async () => {
            const [session, stopped, abandoned] = await Promise.all([
                store.read(saveAsId, 'session'), store.read(saveAsId, 'stopped'), store.read(saveAsId, 'abandoned'),
            ]);
            if (lease === null || session.state !== 'valid' || session.digest !== lease.digest || session.dev !== lease.dev ||
                session.ino !== lease.ino || stopped.state !== 'absent' || abandoned.state !== 'absent') {
                leaseLost = true;
                throw new SaveAsLeaseChangedError(saveAsId);
            }
        };
        const releaseUnstarted = async (parentScope) => {
            try {
                const entries = await readdir(stagingDirectory).catch((error) => {
                    if (isMissingPath(error))
                        return [];
                    throw error;
                });
                if (entries.length > 0)
                    return false;
                await rmdir(stagingDirectory).catch((error) => { if (!isMissingPath(error))
                    throw error; });
                await parentScope.sync();
                await store.remove(saveAsId, 'session');
                pendingId = null;
                return true;
            }
            catch (_error) {
                return false;
            }
        };
        this.#saveAs.active.add(saveAsId);
        try {
            return await withOutputParentScope(output.parent, async (parentScope) => {
                stage = 'save_as';
                let data;
                try {
                    const result = await this.executeHost({
                        kind: 'read',
                        script: SAVE_DOCUMENT_AS_SCRIPT,
                        params: { expectedDocumentKey: input.expectedDocumentKey, outputPath: stagedPath },
                        timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                        hostGate: {
                            beforeHost: async () => {
                                await this.#leaseGuard.assertNoUnresolvedSession();
                                const sessionIdentity = await this.saveSessionIdentityForDocument(document);
                                if (await saveBarrierRefusal(this.bridge.releaseBarrierStore?.() ?? null, document, { prepare: true, sessionIdentity }) !== null)
                                    throw new SaveBarrierRefusedError();
                                await parentScope.assertStable();
                                await assertOutputAbsent(outputPath);
                                const parent = await lstat(output.parent, { bigint: true });
                                const session = {
                                    version: 3, kind: 'save_as_session', saveAsId, documentKey: document.key, sourcePath: document.path,
                                    outputPath, stagingDirectory, stagedPath, parent: { dev: parent.dev.toString(), ino: parent.ino.toString() },
                                    owner, createdAt: new Date().toISOString(),
                                };
                                pendingId = saveAsId;
                                try {
                                    await store.create('session', session);
                                }
                                catch (error) {
                                    const leaseExists = await lstat(store.path(saveAsId, 'session')).then(() => true, (lstatError) => !isMissingPath(lstatError));
                                    if (!leaseExists) {
                                        pendingId = null;
                                        throw new SaveAsLeaseNotRecordedError(saveAsId, error);
                                    }
                                    throw error;
                                }
                                const created = await store.read(saveAsId, 'session');
                                if (created.state !== 'valid')
                                    throw new Error('The save-as session could not be read back after it was published.');
                                lease = { digest: created.digest, dev: created.dev, ino: created.ino };
                                await createStagingDirectory(output.parent, saveAsId, outputPath, SAVE_AS_STAGING_PREFIX);
                                await parentScope.sync();
                            },
                        },
                    });
                    data = result.data;
                }
                catch (error) {
                    if (error instanceof IndeterminateExecutionError) {
                        files.stagedPath = stagedPath;
                        return indeterminate(error.message, error.commandId);
                    }
                    if (error instanceof SaveAsLeaseNotRecordedError)
                        return { outcome: 'failed', reason: 'save_failed', message: error.message, document, files: { ...files } };
                    const detail = parseMcpError(error);
                    const preHost = error instanceof ExportPreconditionError ||
                        ['DOCUMENT_MISMATCH', 'DOCUMENT_KEY_AMBIGUOUS', 'OUTPUT_EXISTS', 'LIFECYCLE_PATH_UNAVAILABLE', 'LIFECYCLE_INVALID_INPUT'].includes(detail?.code ?? '');
                    if (pendingId === null) {
                        if (error instanceof SaveBarrierRefusedError)
                            return rejected('document_not_admitted', error.message);
                        if (error instanceof ExportPreconditionError)
                            return rejected(error.reason === 'output_exists' ? 'output_exists' : 'output_path_invalid', error.message);
                        throw error;
                    }
                    if (!preHost || !(await releaseUnstarted(parentScope))) {
                        return indeterminate(`The save-as stopped before the host saved anything, but its session could not be released: ${describe(error)}`);
                    }
                    if (error instanceof ExportPreconditionError)
                        return rejected(error.reason === 'output_exists' ? 'output_exists' : 'output_path_invalid', error.message);
                    if (detail?.code === 'DOCUMENT_MISMATCH' || detail?.code === 'DOCUMENT_KEY_AMBIGUOUS')
                        return rejected('document_key_mismatch', lifecycleMismatchMessage(detail));
                    if (detail?.code === 'OUTPUT_EXISTS')
                        return rejected('output_exists', `The staging path already exists on the host: ${stagedPath}.`);
                    return rejected('document_not_admitted', lifecycleDetailMessage(detail ?? {}));
                }
                if (data.outcome === 'save_failed') {
                    document = data.document;
                    const stagedGone = await lstat(stagedPath).then(() => false, (error) => isMissingPath(error));
                    if (!data.outputExists && stagedGone && await releaseUnstarted(parentScope)) {
                        return { outcome: 'failed', reason: 'save_failed', message: data.message, document, files: { ...files } };
                    }
                    files.stagedPath = stagedPath;
                    return indeterminate(`saveAs threw but the staged file exists or its session could not be released: ${data.message}`);
                }
                files.stagedPath = stagedPath;
                if (data.outcome === 'verify_mismatch') {
                    document = data.document;
                    return indeterminate(data.message);
                }
                document = data.document;
                const savedContext = data.document;
                stage = 'verify_output';
                let staged;
                try {
                    staged = await readFileFacts(stagedPath);
                }
                catch (error) {
                    return indeterminate(`The staged file could not be verified: ${describe(error)}`);
                }
                const revisionSize = fileRevisionSize(savedContext.fileRevision);
                if (revisionSize === null || revisionSize !== staged.bytes) {
                    return indeterminate(`The host file revision (${String(savedContext.fileRevision)}) does not match the staged file size (${staged.bytes}).`);
                }
                let previousFilePreserved = null;
                if (previousRealPath !== null && previousFacts !== null) {
                    try {
                        const current = await readFileFacts(previousRealPath);
                        previousFilePreserved = sameContentIdentity(previousFacts.identity, current.identity) && current.sha256 === previousFacts.sha256;
                    }
                    catch (error) {
                        return indeterminate(`The previous document file could not be re-inspected: ${describe(error)}`);
                    }
                    if (!previousFilePreserved)
                        return indeterminate('The previous document file changed during save-as.');
                }
                stage = 'publish_output';
                let publishedIdentity;
                try {
                    await syncFile(stagedPath);
                    await syncDirectoryOf(stagingDirectory);
                    const stagingIdentity = await lstat(stagingDirectory, { bigint: true });
                    await assertOwnLease();
                    const publish = {
                        version: 3, kind: 'save_as_publish', saveAsId, stagedPath, outputPath,
                        stagingDirectory: { dev: stagingIdentity.dev.toString(), ino: stagingIdentity.ino.toString() },
                        staged: {
                            dev: staged.identity.dev.toString(), ino: staged.identity.ino.toString(), bytes: staged.bytes,
                            mtimeNs: staged.identity.mtimeNs.toString(), sha256: staged.sha256,
                        },
                        savedDocumentKey: savedContext.key, createdAt: new Date().toISOString(),
                    };
                    await store.create('publish', publish);
                    await assertOwnLease();
                    publishedIdentity = await linkStagedToOutput(stagedPath, outputPath, staged, parentScope);
                }
                catch (error) {
                    if (error instanceof OutputLinkError) {
                        lastMessage = error.message;
                        return { outcome: 'failed', reason: error.reason, message: error.message, document, files: { ...files }, ...pending() };
                    }
                    return indeterminate(`The staged file could not be published: ${describe(error)}`);
                }
                files.outputPath = outputPath;
                stage = 'switch_reference';
                let switched;
                try {
                    const result = await this.executeHost({
                        kind: 'read',
                        script: SAVE_AS_SWITCH_SCRIPT,
                        params: { expectedDocumentKey: savedContext.key, stagedPath, outputPath },
                        timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                        hostGate: {
                            beforeHost: async () => {
                                await this.#leaseGuard.assertNoUnresolvedSession({ exceptSaveAsId: saveAsId });
                                await assertOwnLease();
                                await parentScope.assertStable();
                                const current = await readFileFacts(outputPath);
                                if (!sameContentIdentity(current.identity, publishedIdentity) || current.sha256 !== staged.sha256) {
                                    throw new LifecyclePreconditionError('file_unavailable', 'The published output changed before the document could be switched to it.');
                                }
                            },
                        },
                    });
                    switched = result.data;
                }
                catch (error) {
                    if (error instanceof IndeterminateExecutionError)
                        return indeterminate(error.message, error.commandId);
                    if (error instanceof LifecyclePreconditionError || error instanceof SaveAsLeaseChangedError)
                        return indeterminate(error.message);
                    const detail = parseMcpError(error);
                    if (detail?.code === 'OUTPUT_ALREADY_OPEN') {
                        lastMessage = `Another document already uses the output (collection index ${String(detail.index)}); nothing was closed or opened, so no second document was created. The document still points at the staged file. Close the document that uses ${outputPath}, then run illustrator_reconcile_save_as.`;
                        return { outcome: 'failed', reason: 'output_already_open', message: lastMessage, document, files: { ...files }, ...pending() };
                    }
                    if (detail?.code !== undefined)
                        return indeterminate(`The document could not be switched to the published output (${lifecycleDetailMessage(detail)}). It is still open and points at the staged file.`);
                    return indeterminate(`The document could not be switched to the published output: ${describe(error)}`);
                }
                if (switched.outcome !== 'switched') {
                    if (switched.outcome === 'verify_mismatch')
                        document = switched.document;
                    return indeterminate(`${switched.message} (${switched.outcome}; the output is published at ${outputPath}).`);
                }
                document = switched.document;
                stage = 'cleanup_staging';
                try {
                    await assertOwnLease();
                }
                catch (error) {
                    return indeterminate(describe(error));
                }
                const removal = await removeStagedFile(stagedPath, publishedIdentity, parentScope);
                if (removal !== 'removed')
                    return indeterminate(`The staged name could not be removed (${removal}); the output is published at ${outputPath}.`);
                files.stagedPath = null;
                let finalFacts;
                try {
                    finalFacts = await readFileFacts(outputPath);
                }
                catch (error) {
                    return indeterminate(`The published output could not be re-read: ${describe(error)}`);
                }
                if (finalFacts.sha256 !== staged.sha256 || finalFacts.identity.ino !== publishedIdentity.ino)
                    return indeterminate('The published output changed after the document was switched to it.');
                try {
                    await store.remove(saveAsId, 'session');
                    pendingId = null;
                }
                catch (error) {
                    return indeterminate(`The save-as session could not be released: ${describe(error)}`);
                }
                await store.remove(saveAsId, 'publish').catch(() => undefined);
                const flags = await this.#saveAs.flags(outputPath);
                return {
                    outcome: 'saved',
                    document: withApplication(switched.document, this.describeApplication(switched.document.appVersion)),
                    previous: data.previous,
                    output: serializeFileFacts(finalFacts),
                    previousFilePreserved,
                    staging: { directory: stagingDirectory, removed: true },
                    outputHidden: flags === null ? null : (flags & UF_HIDDEN) !== 0,
                };
            });
        }
        finally {
            this.#saveAs.active.delete(saveAsId);
            if (pendingId !== null && !leaseLost && (await store.read(saveAsId, 'session').catch(() => ({ state: 'invalid' }))).state !== 'absent') {
                await store.create('stopped', {
                    version: 3, kind: 'save_as_stopped', saveAsId, stage, message: lastMessage.slice(0, 4_096), createdAt: new Date().toISOString(),
                }).catch(() => undefined);
            }
        }
    }
    async reconcileSaveAs(input) {
        const store = this.#saveAs.store;
        const { saveAsId, action } = input;
        const base = (status, message, session) => ({
            saveAsId, status, action, message,
            outputPath: session?.outputPath ?? null, stagedPath: session?.stagedPath ?? null, stagingDirectory: session?.stagingDirectory ?? null,
            documents: null, outputHidden: null, owner: null, retained: null, nextCall: null,
        });
        const next = (args) => ({ tool: 'illustrator_reconcile_save_as', arguments: { save_as_id: saveAsId, ...args } });
        const read = await store.read(saveAsId, 'session');
        if (read.state === 'absent')
            return base('no_session', `No save-as session ${saveAsId} is unresolved.`, null);
        if (read.state === 'foreign')
            throw new Error(`${saveAsId} is an export session; use illustrator_reconcile_export.`);
        if (read.state === 'invalid') {
            if (!(await store.isSaveAsLease(saveAsId))) {
                throw new Error(`${saveAsId}.session.json is not a readable save-as session (${read.reason}); use illustrator_reconcile_export.`);
            }
            if (action !== 'abandon' || input.confirmSaveAsId !== saveAsId) {
                return { ...base('blocked', `The save-as session record is unreadable (${read.reason}). Only action=abandon with confirm_save_as_id equal to save_as_id releases it; stop every other MCP server first, because its owner cannot be checked.`, null), nextCall: next({ action: 'abandon', confirm_save_as_id: saveAsId }) };
            }
            await this.abandonSaveAsLease(saveAsId, [], null);
            return { ...base('abandoned', 'The unreadable save-as session was released without touching any file. Check the output folder for a hidden .illustrator-studio-mcp-save-as- directory yourself.', null), retained: [] };
        }
        const session = read.record;
        const state = await this.#saveAs.state(session);
        if (state !== 'orphan') {
            return {
                ...base('in_progress', state === 'in_progress'
                    ? `The save-as is still running in MCP server process ${session.owner.pid}; wait for it to finish. Nothing was changed.`
                    : 'The owner of this save-as could not be checked (its process start time or boot session could not be read). Nothing was changed; stop the other MCP servers and inspect again.', session),
                owner: { pid: session.owner.pid, processStartedAt: session.owner.processStartedAt },
            };
        }
        const leaseUnchanged = async () => {
            const current = await store.read(saveAsId, 'session');
            if (current.state !== 'valid' || current.digest !== read.digest || await this.#saveAs.state(current.record) !== 'orphan') {
                throw new SaveAsLeaseChangedError(saveAsId);
            }
        };
        let documents = [];
        try {
            await this.executeHost({
                kind: 'read',
                script: SAVE_AS_INVENTORY_SCRIPT,
                params: { stagedPath: session.stagedPath, outputPath: session.outputPath },
                hostGate: { beforeHost: leaseUnchanged, afterHost: async ({ data }) => { documents = await matchingDocumentPaths(data, [session.stagedPath, session.outputPath]); } },
            });
        }
        catch (error) {
            if (error instanceof IndeterminateExecutionError) {
                return base('command_locked', `Illustrator is held by command ${error.commandId}. Run illustrator_reconcile for it (a stopped read can be abandoned), then inspect this save-as again.`, session);
            }
            if (error instanceof SaveAsLeaseChangedError)
                return base('retry', error.message, session);
            throw error;
        }
        const publishRead = await store.read(saveAsId, 'publish');
        const publish = publishRead.state === 'valid' ? publishRead.record : publishRead.state === 'absent' ? null : 'invalid';
        const facts = await collectSaveAsFacts(session, this.#saveAs.flags);
        let outputSha256 = null;
        if (publish !== null && publish !== 'invalid' && facts.output.state === 'present' && !outputIsDataless(facts) &&
            facts.output.dev.toString() === publish.staged.dev && facts.output.ino.toString() === publish.staged.ino) {
            try {
                const hashed = await readFileFacts(session.outputPath);
                const observedIdentity = { ...hashed.identity, dev: facts.output.dev, ino: facts.output.ino, size: facts.output.size, mtimeNs: facts.output.mtimeNs };
                if (!sameContentIdentity(hashed.identity, observedIdentity)) {
                    return base('retry', 'The output changed while it was being read (a sync folder may still be updating it). Nothing was changed; inspect again.', session);
                }
                outputSha256 = hashed.sha256;
            }
            catch (_error) {
                return base('retry', 'The output changed while it was being read (a sync folder may still be updating it). Nothing was changed; inspect again.', session);
            }
        }
        const classification = classifySaveAs({ session, publish, facts, documents, outputSha256 });
        const observed = (status, message) => ({ ...base(status, message, session), documents, outputHidden: outputHiddenOf(facts) });
        const release = async () => {
            await leaseUnchanged();
            await store.remove(saveAsId, 'session');
            await store.remove(saveAsId, 'publish').catch(() => undefined);
            await store.remove(saveAsId, 'stopped').catch(() => undefined);
        };
        const released = async (message) => {
            await release();
            const outputHidden = facts.output.state === 'present' ? await this.waitOutputVisible(session.outputPath) : null;
            const hint = outputHidden === true ? ' The output still carries the sync folder\'s hidden flag; it normally clears within a few seconds (check it in Finder).' : '';
            return { ...observed('released', `${message}${hint}`), outputHidden };
        };
        try {
            if (action === 'abandon') {
                if (input.confirmSaveAsId !== saveAsId)
                    throw new Error('action=abandon requires confirm_save_as_id equal to save_as_id.');
                const retained = [];
                if (facts.staging.state !== 'absent')
                    retained.push(session.stagingDirectory);
                if (facts.staged.state === 'present')
                    retained.push(session.stagedPath);
                if (facts.output.state === 'present' && publish !== null && publish !== 'invalid' &&
                    facts.output.dev.toString() === publish.staged.dev && facts.output.ino.toString() === publish.staged.ino)
                    retained.push(session.outputPath);
                if (publishRead.state !== 'absent')
                    retained.push(store.path(saveAsId, 'publish'));
                const outputHidden = outputHiddenOf(facts);
                await leaseUnchanged();
                await this.abandonSaveAsLease(saveAsId, retained, outputHidden);
                return {
                    ...observed('abandoned', 'The save-as session was released and every file was left in place. Close a document that points at the staged file without saving it (saving could rewrite the published output through the shared inode), and save it again with illustrator_save_document_as if you need the output.'),
                    retained, outputHidden,
                };
            }
            switch (classification.status) {
                case 'not_started': {
                    await leaseUnchanged();
                    if (facts.staging.state === 'directory') {
                        await withOutputParentScope(dirname(session.outputPath), async (scope) => {
                            await rmdir(session.stagingDirectory);
                            await scope.sync();
                        });
                    }
                    return await released('The save-as never saved anything; its empty staging directory and session were removed.');
                }
                case 'released':
                    return await released('The save-as had already converged; its session was released.');
                case 'published_staging_left': {
                    if (action !== 'cleanup_staging') {
                        return { ...observed('published_staging_left', `The output ${session.outputPath} is published; only the staging name is left. Run action=cleanup_staging.${documents.some((document) => sameFilePath(document.path, session.outputPath)) ? '' : ' Then open the output with illustrator_open_document.'}`), nextCall: next({ action: 'cleanup_staging' }) };
                    }
                    await leaseUnchanged();
                    if (facts.staged.state === 'present' && facts.output.state === 'present') {
                        const identity = { dev: facts.output.dev, ino: facts.output.ino, size: facts.output.size, mtimeNs: facts.output.mtimeNs, ctimeNs: 0n };
                        const removal = await withOutputParentScope(dirname(session.outputPath), async (scope) => await removeStagedFile(session.stagedPath, identity, scope));
                        if (removal !== 'removed')
                            return observed('blocked', `The staging name could not be removed (${removal}); nothing else was changed.`);
                    }
                    else {
                        await withOutputParentScope(dirname(session.outputPath), async (scope) => {
                            await rmdir(session.stagingDirectory);
                            await scope.sync();
                        });
                    }
                    return await released(`The staging name was removed; ${session.outputPath} is the only name of the saved file.`);
                }
                case 'published_document_on_staging': {
                    if (action !== 'switch_document') {
                        return {
                            ...observed('published_document_on_staging', `The output is published and the document still points at the staged file. Run action=switch_document with confirm_document_key set to ${classification.document.key}: it closes that document without saving and opens the output (nothing is written).`),
                            nextCall: next({ action: 'switch_document', confirm_document_key: classification.document.key }),
                        };
                    }
                    if (input.confirmDocumentKey !== classification.document.key)
                        throw new Error('confirm_document_key must equal the key inspect reported for the document on the staged file.');
                    if (facts.output.state !== 'present' || publish === null || publish === 'invalid')
                        throw new Error('The published output is not available.');
                    const hashedIdentity = { dev: facts.output.dev, ino: facts.output.ino, size: facts.output.size, mtimeNs: facts.output.mtimeNs };
                    let switched;
                    try {
                        const result = await this.executeHost({
                            kind: 'read',
                            script: SAVE_AS_SWITCH_SCRIPT,
                            params: { expectedDocumentKey: classification.document.key, stagedPath: session.stagedPath, outputPath: session.outputPath },
                            timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                            hostGate: {
                                beforeHost: async () => {
                                    await leaseUnchanged();
                                    const parent = await lstat(dirname(session.outputPath), { bigint: true });
                                    const staging = await lstat(session.stagingDirectory, { bigint: true }).catch((error) => {
                                        if (isMissingPath(error))
                                            throw new LifecyclePreconditionError('file_unavailable', 'The staging directory is gone; nothing was switched. Inspect again.');
                                        throw error;
                                    });
                                    if (parent.dev.toString() !== session.parent.dev || parent.ino.toString() !== session.parent.ino ||
                                        staging.dev.toString() !== publish.stagingDirectory.dev || staging.ino.toString() !== publish.stagingDirectory.ino) {
                                        throw new LifecyclePreconditionError('file_unavailable', 'The output or staging directory was replaced; nothing was switched.');
                                    }
                                    const current = await lstat(session.outputPath, { bigint: true });
                                    if (current.dev !== hashedIdentity.dev || current.ino !== hashedIdentity.ino || current.size !== hashedIdentity.size || current.mtimeNs !== hashedIdentity.mtimeNs) {
                                        throw new LifecyclePreconditionError('file_unavailable', 'The output changed after it was verified; nothing was switched.');
                                    }
                                },
                            },
                        });
                        switched = result.data;
                    }
                    catch (error) {
                        if (error instanceof IndeterminateExecutionError) {
                            return observed('command_locked', `The switch did not finish (${error.message}). Run illustrator_reconcile for ${error.commandId} (abandon it once it has stopped), then inspect this save-as again.`);
                        }
                        if (error instanceof LifecyclePreconditionError || error instanceof SaveAsLeaseChangedError)
                            return observed('retry', error.message);
                        const detail = parseMcpError(error);
                        if (detail !== null)
                            return observed('retry', `The document was not switched (${lifecycleDetailMessage(detail)}); inspect again.`);
                        throw error;
                    }
                    if (switched.outcome !== 'switched')
                        return observed('retry', `The switch ended as ${switched.outcome}: ${switched.message} Inspect again.`);
                    const identity = { ...hashedIdentity, ctimeNs: 0n };
                    const removal = await withOutputParentScope(dirname(session.outputPath), async (scope) => await removeStagedFile(session.stagedPath, identity, scope));
                    if (removal !== 'removed')
                        return observed('published_staging_left', `The document now points at the output, but the staging name could not be removed (${removal}). Inspect again.`);
                    return await released(`The document now points at ${session.outputPath} and the staging name was removed.`);
                }
                case 'document_modified':
                    return observed('document_modified', 'The document on the staged file has unsaved changes. In Illustrator, save it under another name (File > Save As) or close it discarding the changes, then inspect again. Do not save it in place: the staged file shares its inode with the published output. action=abandon is the last resort.');
                case 'saved_not_published':
                    return { ...observed('saved_not_published', `${classification.reason} The saved file is kept at ${session.stagedPath}; nothing is deleted. Release the session with action=abandon, then close that document without saving and save it again with illustrator_save_document_as.`), nextCall: next({ action: 'abandon', confirm_save_as_id: saveAsId }) };
                case 'output_not_local':
                    return observed('output_not_local', 'The output is not downloaded from its sync folder yet, so it is not read. Download it in Finder, then inspect again.');
                case 'blocked':
                    return { ...observed('blocked', `${classification.reason} Nothing is changed automatically; only action=abandon (which deletes nothing) releases the session.`), nextCall: next({ action: 'abandon', confirm_save_as_id: saveAsId }) };
                default: {
                    const unexpected = classification;
                    throw new Error(`Unhandled save-as classification ${JSON.stringify(unexpected)}.`);
                }
            }
        }
        catch (error) {
            if (error instanceof SaveAsLeaseChangedError)
                return observed('retry', error.message);
            throw error;
        }
    }
    async abandonSaveAsLease(saveAsId, retained, outputHidden) {
        const store = this.#saveAs.store;
        if (!(await store.isSaveAsLease(saveAsId)))
            throw new Error(`${saveAsId} is not a save-as session; use illustrator_reconcile_export.`);
        const abandoned = await store.read(saveAsId, 'abandoned');
        if (abandoned.state === 'invalid')
            throw new Error(`The abandoned record of ${saveAsId} is unreadable; nothing was changed.`);
        if (abandoned.state === 'absent') {
            await store.create('abandoned', { version: 3, kind: 'save_as_abandoned', saveAsId, retained, outputHidden, createdAt: new Date().toISOString() });
        }
        await store.remove(saveAsId, 'session');
    }
    async waitOutputVisible(outputPath) {
        for (let attempt = 0;; attempt += 1) {
            const flags = await this.#saveAs.flags(outputPath);
            if (flags === null)
                return null;
            if ((flags & UF_HIDDEN) === 0)
                return false;
            if (attempt >= 12)
                return true;
            await new Promise((resolve) => { setTimeout(resolve, 250); });
        }
    }
    async saveDocument(input) {
        let stage = 'read_document';
        let document = null;
        let sourcePath = null;
        let scan = null;
        const toolStarted = this.#saveScans.now();
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', stage, message, commandId, document, path: sourcePath });
        const rejected = (reason, message) => ({ outcome: 'rejected', reason, message, document });
        if (input.scanContinuation !== undefined) {
            try {
                scan = this.#saveScans.start(input);
                if (input.acceptChunkedScanWindow !== true || scan.save === undefined)
                    throw new EditSessionScanError('scan_context_mismatch');
            }
            catch (error) {
                if (error instanceof EditSessionScanError)
                    return rejected(error.reason, 'The save scan token expired or does not match this request. Nothing was written; start a fresh save with explicit consent.');
                throw error;
            }
        }
        const preflight = await this.readLifecycleDocument(scan?.save?.documentKey ?? input.expectedDocumentKey, true);
        if ('indeterminate' in preflight)
            return indeterminate(preflight.indeterminate.message, preflight.indeterminate.commandId);
        if ('rejected' in preflight)
            return rejected(preflight.rejected.reason, preflight.rejected.message);
        document = preflight.read.document;
        if (document.path === null)
            return rejected('document_not_admitted', document.mutationBlockedReason ?? 'The document path could not be read; save is refused.');
        if (document.fileRevision === null) {
            return rejected('document_not_admitted', document.mutationProfile === 'unsaved_document'
                ? 'The document has no file to overwrite; use illustrator_save_document_as.'
                : (document.mutationBlockedReason ?? 'The document file revision could not be verified; save is refused.'));
        }
        if (document.saved)
            return rejected('nothing_to_save', 'The document has no unsaved changes.');
        const barredEarly = await saveBarrierRefusal(this.bridge.releaseBarrierStore?.() ?? null, document, { prepare: false, ownPathOnly: true });
        if (barredEarly !== null)
            return rejected('document_not_admitted', barredEarly);
        try {
            await assertCanonicalDocumentPath(document.path);
        }
        catch (error) {
            if (error instanceof LifecyclePreconditionError)
                return rejected(error.reason === 'source_file_unavailable' ? 'source_file_unavailable' : 'document_not_admitted', error.message);
            throw error;
        }
        if ((await lstat(document.path)).nlink !== 1) {
            return rejected('document_not_admitted', 'This file shares its content with another name (a hard link, for example a staging file left by an interrupted illustrator_save_document_as). Saving in place could change the other file too; save it under a new name with illustrator_save_document_as instead.');
        }
        stage = 'verify_backup';
        let record;
        try {
            record = await this.backupStore.readRecord(input.backupId);
        }
        catch (error) {
            if (error instanceof BackupRecordError)
                return rejected('backup_invalid', error.message);
            throw error;
        }
        if (record === null)
            return rejected('backup_not_found', `No backup record exists for backup_id ${input.backupId}; run illustrator_create_backup first.`);
        let sourceReal;
        try {
            sourceReal = await realpath(document.path);
        }
        catch (error) {
            return rejected('source_file_unavailable', `The document file could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
        }
        sourcePath = document.path;
        if (!sameFilePath(record.sourcePath, sourceReal))
            return rejected('backup_mismatch', `Backup ${input.backupId} was taken from ${record.sourcePath}, not from ${sourceReal}.`);
        if (record.sourceFileRevision !== document.fileRevision) {
            return rejected('backup_stale', `Backup ${input.backupId} recorded file revision ${record.sourceFileRevision}; the document reports ${document.fileRevision}. Create a new backup.`);
        }
        let sourceFacts;
        try {
            sourceFacts = await readFileFacts(sourceReal);
        }
        catch (error) {
            return rejected('source_file_unavailable', error instanceof Error ? error.message : String(error));
        }
        if (sourceFacts.sha256 !== record.sha256 || sourceFacts.bytes !== record.bytes) {
            return rejected('backup_stale', `The file on disk no longer matches backup ${input.backupId} (bytes ${sourceFacts.bytes}/${record.bytes}). Create a new backup.`);
        }
        let backupFacts;
        try {
            backupFacts = await readFileFacts(record.backupPath);
        }
        catch (error) {
            return rejected('backup_file_unavailable', `The backup file could not be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (backupFacts.sha256 !== record.sha256 || backupFacts.bytes !== record.bytes) {
            return rejected('backup_file_unavailable', `The backup file ${record.backupPath} no longer matches its record.`);
        }
        const sessionRead = await this.#editSessions.store.findActiveForPath(sourceReal);
        if (sessionRead.state === 'invalid') {
            return rejected('edit_session_invalid', `An edit session record cannot be read (${sessionRead.reason}); inspect it with illustrator_get_edit_session before saving.`);
        }
        const currentSession = sessionRead.state === 'valid' ? sessionRead.record : null;
        if (scan !== null && (currentSession === null || currentSession.sessionId !== scan.save.session.sessionId ||
            currentSession.state !== 'open' || currentSession.head.sequence !== scan.save.session.head.sequence)) {
            return rejected('edit_session_mismatch', new EditSessionChangedDuringSaveError().message);
        }
        const session = scan?.save?.session ?? currentSession;
        if (session?.state === 'suspended') {
            return rejected('edit_session_suspended', `Edit session ${session.sessionId} is suspended (${session.suspendReason ?? 'unknown'}); the document may hold changes the session cannot vouch for. ` +
                'Restore the session backup, or close the session with illustrator_close_edit_session and save on your own judgement. ' + USER_SAVED_SESSION_HINT);
        }
        if (session !== null && session.backupId !== record.backupId) {
            return rejected('edit_session_backup_mismatch', `Edit session ${session.sessionId} was opened with backup ${session.backupId}; save with that backup_id.`);
        }
        if (session !== null && (!Number.isSafeInteger(preflight.read.pageItemCount) || preflight.read.pageItemCount === null)) {
            return rejected('edit_session_scan_incomplete', 'The item count could not be read; nothing was written and the session remains open.');
        }
        if (scan === null && session !== null && preflight.read.pageItemCount > EDIT_SESSION_MAX_ITEMS && input.acceptChunkedScanWindow === true) {
            scan = this.#saveScans.start(input);
            scan.save = { documentKey: document.key, session };
            scan.backup = record;
            scan.sourceIdentity = sourceFacts.identity;
            scan.backupIdentity = backupFacts.identity;
            scan.total = preflight.read.pageItemCount;
        }
        if (scan !== null && (!isDeepStrictEqual(record, scan.backup) || !sameContentIdentity(sourceFacts.identity, scan.sourceIdentity) ||
            !sameContentIdentity(backupFacts.identity, scan.backupIdentity))) {
            return rejected('backup_stale', 'The source or backup record/identity changed during the save scan. Nothing was written.');
        }
        const inProgress = () => ({ outcome: 'scan_in_progress', scan_continuation: this.#saveScans.continue(scan),
            progress: { items: scan.partial.visited, total: scan.total, calls: scan.calls,
                elapsedMs: this.#saveScans.now() - scan.startedAt, estimatedRemainingMs: scan.estimatedRemainingMs } });
        const fitsDispatch = () => this.#saveScans.now() - toolStarted + this.#scanTiming.deadlineMs + EDIT_SESSION_SCAN_MARGIN_MS <= this.#scanTiming.toolWallMs;
        const verifyBackup = async () => {
            const currentRecord = await this.backupStore.readRecord(record.backupId);
            const currentBackup = await readFileFacts(record.backupPath);
            if (!isDeepStrictEqual(currentRecord, record) || !sameContentIdentity(currentBackup.identity, backupFacts.identity) ||
                currentBackup.sha256 !== record.sha256 || currentBackup.bytes !== record.bytes) {
                throw new LifecyclePreconditionError('backup_stale', 'The verified backup changed during the save scan.');
            }
        };
        let verification;
        let sessionOutcome;
        stage = 'save';
        let data;
        try {
            for (;;) {
                if (scan !== null) {
                    this.#saveScans.checkLimits(scan);
                    if (!fitsDispatch())
                        return inProgress();
                }
                const result = await this.executeHost({
                    kind: 'read',
                    script: SAVE_DOCUMENT_SCRIPT,
                    params: {
                        expectedDocumentKey: scan?.save?.documentKey ?? input.expectedDocumentKey, path: document.path, expectedRevision: record.sourceFileRevision, expectedBytes: record.bytes,
                        ...(session === null ? {} : { editSession: {
                                structureDigest: session.head.structureDigest, itemAggregate: session.head.itemAggregate,
                                deadlineMs: EDIT_SESSION_SCAN_DEADLINE_MS, maxItems: EDIT_SESSION_MAX_ITEMS,
                                ...(scan === null ? {} : { chunk: { cursor: scan.cursor, partial: scan.partial, total: scan.total,
                                        scanDeadlineAt: scan.startedAt + EDIT_SESSION_CHUNKED_MAX_TOTAL_MS,
                                        options: { budgetMs: this.#scanTiming.budgetMs, deadlineMs: this.#scanTiming.deadlineMs,
                                            maxItems: EDIT_SESSION_CHUNKED_MAX_ITEMS, maxRows: EDIT_SESSION_CHUNKED_MAX_ITEMS,
                                            loMaxRows: EDIT_SESSION_CHUNKED_MAX_ITEMS, expectStructure: session.head.structureDigest } } }),
                            } }),
                    },
                    timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async () => {
                            await this.#leaseGuard.assertNoUnresolvedSession();
                            await assertSameFilePathIdentity(sourcePath, sourceReal);
                            await assertSameFilePathIdentity(record.sourcePath, sourceReal);
                            const current = await readFileFacts(sourceReal);
                            if (!sameContentIdentity(current.identity, sourceFacts.identity) || current.sha256 !== sourceFacts.sha256) {
                                throw new LifecyclePreconditionError('backup_stale', 'The document file changed after the backup was verified; save is refused.');
                            }
                            const sessionNow = await this.#editSessions.store.findActiveForPath(sourceReal);
                            const sameSession = session === null
                                ? sessionNow.state === 'missing'
                                : sessionNow.state === 'valid' && sessionNow.record.sessionId === session.sessionId && sessionNow.record.state === 'open' &&
                                    sessionNow.record.head.sequence === session.head.sequence;
                            if (!sameSession)
                                throw new EditSessionChangedDuringSaveError();
                            const sessionIdentity = sessionNow.state === 'valid'
                                ? await proveSaveSessionIdentity(sessionNow.record, { path: sourcePath, fileRevision: document.fileRevision })
                                : { state: 'unproven', reason: 'no_session' };
                            if (await saveBarrierRefusal(this.bridge.releaseBarrierStore?.() ?? null, document, { prepare: true, sessionIdentity }) !== null)
                                throw new SaveBarrierRefusedError();
                            if (scan !== null) {
                                await verifyBackup();
                                this.#saveScans.checkLimits(scan);
                                if (!fitsDispatch())
                                    throw new EditSessionSaveYield();
                            }
                        },
                        afterHost: async ({ commandId, data: hostData }) => {
                            if (session === null)
                                return;
                            const host = hostData;
                            if (scan !== null && (host.outcome === 'edit_session_scan_continue' || host.outcome === 'saved')) {
                                try {
                                    const chunk = editSessionChunkSchema.parse(host.chunk);
                                    this.#saveScans.accept(scan, chunk, host.outcome === 'saved');
                                    if (host.outcome === 'saved') {
                                        if (!chunk.done || host.timing === undefined)
                                            throw new Error('A saved chunk has no complete scan or timing evidence.');
                                        await verifyBackup();
                                        const facts = await readFileFacts(sourceReal);
                                        await assertSameFilePathIdentity(host.document.path, sourceReal);
                                        if (fileRevisionSize(host.document.fileRevision) !== facts.bytes)
                                            throw new Error('The saved file facts differ from the host revision.');
                                        verification = { mode: 'chunked', calls: scan.calls,
                                            windowMs: Math.max(0, this.#saveScans.now() - scan.startedAt - host.timing.saveMs - host.timing.verifyMs),
                                            scanMs: scan.partial.durationMs, ...host.timing };
                                    }
                                }
                                catch (error) {
                                    if (host.outcome === 'saved')
                                        throw new IndeterminateExecutionError('The saved chunk could not be verified under the lock; reconcile before any further mutation. ' +
                                            (error instanceof Error ? error.message : String(error)), commandId);
                                    throw error;
                                }
                            }
                            const suspension = saveSessionSuspension(host.outcome, 'check' in host ? host.check : null, session.head.structureDigest);
                            if (suspension !== null) {
                                await this.#editSessions.store.suspend(session.sessionId, suspension);
                            }
                            else if (host.outcome === 'saved') {
                                let state = 'open';
                                try {
                                    state = (await this.#editSessions.store.close(session.sessionId)).state === 'closed' ? 'closed' : 'open';
                                }
                                catch {
                                    state = 'open';
                                }
                                sessionOutcome = { sessionId: session.sessionId, state, scanMs: host.editSessionCheck?.scanMs ?? 0 };
                            }
                        },
                    },
                });
                data = result.data;
                if (data.outcome !== 'edit_session_scan_continue')
                    break;
            }
        }
        catch (error) {
            if (error instanceof EditSessionSaveYield)
                return inProgress();
            if (error instanceof EditSessionScanError)
                return rejected(error.reason, 'The save scan stopped: ' + error.reason + '. Nothing was written; the session is unchanged. Do not restart Illustrator before saving its pending changes.');
            if (error instanceof IndeterminateExecutionError)
                return indeterminate(error.message, error.commandId);
            if (error instanceof EditSessionChangedDuringSaveError)
                return rejected('edit_session_mismatch', error.message);
            if (error instanceof SaveBarrierRefusedError)
                return rejected('document_not_admitted', error.message);
            if (error instanceof LifecyclePreconditionError)
                return rejected('backup_stale', error.message);
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH' || detail?.code === 'DOCUMENT_KEY_AMBIGUOUS')
                return rejected('document_key_mismatch', lifecycleMismatchMessage(detail));
            if (detail?.code === 'NOTHING_TO_SAVE')
                return rejected('nothing_to_save', 'The document has no unsaved changes.');
            if (detail?.code === 'SAVE_PATH_MISMATCH' || detail?.code === 'SOURCE_FILE_MISSING' || detail?.code === 'LIFECYCLE_PATH_UNAVAILABLE' || detail?.code === 'LIFECYCLE_INVALID_INPUT') {
                return rejected('document_not_admitted', lifecycleDetailMessage(detail));
            }
            throw error;
        }
        if (data.outcome === 'precondition_changed') {
            document = data.document;
            return indeterminate(`${data.message} Host observed length ${String(data.observed.length)}, revision ${String(data.observed.revision)}; expected ${record.bytes} bytes, revision ${record.sourceFileRevision}. Re-read the document and create a new backup before saving.`);
        }
        if (data.outcome === 'save_failed') {
            document = data.document;
            let unchanged = false;
            try {
                const current = await readFileFacts(sourceReal);
                unchanged = sameContentIdentity(current.identity, sourceFacts.identity) && current.sha256 === sourceFacts.sha256;
            }
            catch {
                unchanged = false;
            }
            if (unchanged && data.document?.fileRevision === record.sourceFileRevision)
                return { outcome: 'failed', reason: 'save_failed', message: data.message, document };
            return indeterminate(`save threw and the file state could not be proven unchanged: ${data.message}`);
        }
        if (data.outcome === 'verify_mismatch') {
            document = data.document;
            return indeterminate(data.message);
        }
        if (data.outcome === 'edit_session_scan_incomplete') {
            document = data.document;
            return rejected('edit_session_scan_incomplete', editSessionScanIncompleteMessage(session?.sessionId ?? '', data.check) +
                (data.check.overLimit && input.acceptChunkedScanWindow !== true ? ` Chunked save supports up to ${EDIT_SESSION_CHUNKED_MAX_ITEMS.toLocaleString('en-US')} items and requires accept_chunked_scan_window=true after asking the user.` : ''));
        }
        if (data.outcome === 'edit_session_mismatch') {
            document = data.document;
            const check = data.check;
            return rejected('edit_session_mismatch', `Nothing was written: the document no longer matches edit session ${session?.sessionId ?? ''} ` +
                `(${check.structureDigest !== session?.head.structureDigest ? 'the structure changed' : 'an item changed outside the session'}), and the session is suspended. ` +
                'Restore the session backup, or close the session and save on your own judgement.');
        }
        document = data.document;
        stage = 'verify_file';
        let facts;
        try {
            facts = await readFileFacts(sourceReal);
        }
        catch (error) {
            return indeterminate(`The saved file could not be verified: ${error instanceof Error ? error.message : String(error)}`);
        }
        const revisionSize = fileRevisionSize(data.document.fileRevision);
        if (revisionSize === null || revisionSize !== facts.bytes) {
            return indeterminate(`The host file revision (${String(data.document.fileRevision)}) does not match the saved file size (${facts.bytes}).`);
        }
        return {
            outcome: 'saved',
            document: withApplication(data.document, this.describeApplication(data.document.appVersion)),
            previous: data.previous,
            backup: { backupId: record.backupId, backupPath: record.backupPath, bytes: record.bytes, sha256: record.sha256 },
            file: { ...serializeFileFacts(facts), inodeReplaced: facts.identity.ino !== sourceFacts.identity.ino },
            ...(sessionOutcome === undefined ? {} : { editSession: sessionOutcome }),
            ...(verification === undefined ? {} : { verification }),
        };
    }
    async openDocument(input) {
        let stage = 'validate_path';
        let path = null;
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', stage, message, commandId, document: null, path });
        let validated;
        try {
            validated = await validateOpenPath(input.path, this.exportStore.stateRootPath);
        }
        catch (error) {
            if (error instanceof LifecyclePreconditionError) {
                return { outcome: 'rejected', reason: error.reason === 'source_file_unavailable' ? 'source_file_unavailable' : 'path_invalid', message: error.message, document: null };
            }
            throw error;
        }
        path = validated.path;
        stage = 'open';
        let data;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: OPEN_DOCUMENT_SCRIPT,
                params: { path: validated.path },
                timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                hostGate: { beforeHost: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); } },
            });
            data = result.data;
        }
        catch (error) {
            if (error instanceof IndeterminateExecutionError)
                return indeterminate(error.message, error.commandId);
            const detail = parseMcpError(error);
            if (detail?.code === 'ALREADY_OPEN') {
                return { outcome: 'rejected', reason: 'already_open', message: `The file is already open in Illustrator (collection index ${String(detail.index)}); bind its document key instead of opening it again.`, document: detail.document ?? null };
            }
            if (detail?.code === 'OPEN_FILE_MISSING')
                return { outcome: 'rejected', reason: 'source_file_unavailable', message: `Illustrator cannot see the file at ${validated.path}.`, document: null };
            if (detail?.code === 'LIFECYCLE_INVALID_INPUT')
                return { outcome: 'rejected', reason: 'path_invalid', message: lifecycleDetailMessage(detail), document: null };
            throw error;
        }
        if (data.outcome === 'open_failed') {
            if (data.inventory.countAfter !== data.inventory.countBefore)
                return indeterminate(`app.open threw but the document count changed: ${data.message}`);
            return { outcome: 'failed', reason: 'open_failed', message: data.message, inventory: data.inventory };
        }
        if (data.outcome === 'returned_existing') {
            return { outcome: 'rejected', reason: 'already_open', message: `Illustrator returned an already-open document for this file (collection index ${String(data.index)}); nothing was opened or closed. Bind its document key instead.`, document: data.document };
        }
        if (data.outcome === 'verify_mismatch_no_rollback')
            return indeterminate(data.message);
        if (data.outcome !== 'opened')
            return data;
        return { outcome: 'opened', document: withApplication(data.document, this.describeApplication(data.document.appVersion)), inventory: data.inventory };
    }
    async closeDocument(input) {
        let stage = 'read_document';
        let document = null;
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', stage, message, commandId, document, path: document?.path ?? null });
        const preflight = await this.readLifecycleDocument(input.expectedDocumentKey);
        if ('indeterminate' in preflight)
            return indeterminate(preflight.indeterminate.message, preflight.indeterminate.commandId);
        if ('rejected' in preflight)
            return { outcome: 'rejected', reason: 'document_key_mismatch', message: preflight.rejected.message, document: null };
        document = preflight.read.document;
        if (!document.saved && !input.discardChanges) {
            return { outcome: 'rejected', reason: 'unsaved_changes', message: 'The document has unsaved changes; pass discard_changes: true to close it without saving, or save it first.', document };
        }
        let fileBefore = null;
        let fileReal = null;
        if (document.path !== null && document.fileRevision !== null) {
            try {
                fileReal = await realpath(document.path);
                fileBefore = await readFileFacts(fileReal);
            }
            catch {
                fileBefore = null;
                fileReal = null;
            }
        }
        stage = 'close';
        let data;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: CLOSE_DOCUMENT_SCRIPT,
                params: { expectedDocumentKey: input.expectedDocumentKey, discardChanges: input.discardChanges },
                timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                hostGate: { beforeHost: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); } },
            });
            data = result.data;
        }
        catch (error) {
            if (error instanceof IndeterminateExecutionError)
                return indeterminate(error.message, error.commandId);
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH' || detail?.code === 'DOCUMENT_KEY_AMBIGUOUS')
                return { outcome: 'rejected', reason: 'document_key_mismatch', message: lifecycleMismatchMessage(detail), document: null };
            if (detail?.code === 'UNSAVED_CHANGES')
                return { outcome: 'rejected', reason: 'unsaved_changes', message: lifecycleDetailMessage(detail), document };
            throw error;
        }
        if (data.outcome === 'close_failed') {
            return indeterminate(`close was attempted but did not produce positive terminal evidence: ${data.message}`);
        }
        if (data.outcome === 'verify_mismatch')
            return indeterminate(data.message);
        stage = 'verify_file';
        let filePreserved = null;
        if (fileBefore !== null && fileReal !== null) {
            try {
                const after = await readFileFacts(fileReal);
                filePreserved = sameContentIdentity(fileBefore.identity, after.identity) && after.sha256 === fileBefore.sha256;
            }
            catch (error) {
                return indeterminate(`The closed document's file could not be re-inspected: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (!filePreserved)
                return indeterminate('The closed document\'s file changed during close.');
        }
        return {
            outcome: 'closed',
            closed: data.closed,
            inventory: data.inventory,
            activeDocument: data.activeDocument === null ? null : withApplication(data.activeDocument, this.describeApplication(data.activeDocument.appVersion)),
            filePreserved,
        };
    }
    async listLayers() {
        const result = await this.executeHost({ kind: 'read', script: LIST_LAYERS_SCRIPT, hostGate: this.reportingReadGate() });
        return result.data;
    }
    async listDocuments() {
        const result = await this.executeHost({ kind: 'read', script: LIST_DOCUMENTS_SCRIPT, hostGate: this.reportingReadGate('list') });
        const { appVersion, ...list } = result.data;
        return { ...list, application: this.describeApplication(appVersion) };
    }
    async listSwatches(input) {
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: LIST_SWATCHES_SCRIPT, hostGate: this.reportingReadGate(),
                params: input,
            });
            return result.data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            }
            throw error;
        }
    }
    async listTextStyles(input) {
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: LIST_TEXT_STYLES_SCRIPT, hostGate: this.reportingReadGate(),
                params: {
                    expectedDocumentKey: input.expectedDocumentKey,
                    target: input.target ?? null,
                },
            });
            return result.data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            }
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new ObjectNotFoundError(detail.uuid ?? input.target?.uuid ?? '');
            throw error;
        }
    }
    async findFonts(input) {
        const names = fontLookupInputSchema.parse(input.postScriptNames);
        if (new Set(names).size !== names.length)
            throw new Error('post_script_names must not repeat a name.');
        const result = await this.executeHost({ kind: 'read', script: FIND_FONTS_SCRIPT,
            params: { postScriptNames: names } });
        const parsed = fontLookupResultSchema.parse(result.data);
        if (parsed.fonts.length !== names.length || parsed.fonts.some((entry, index) => entry.requested !== names[index])) {
            throw new Error('Font lookup did not answer exactly the requested names.');
        }
        const resolved = parsed.fonts.filter((entry) => entry.status === 'installed').map((entry) => entry.requested);
        const target = this.bridge.applicationTarget?.() ?? null;
        const verification = resolved.length === 0 ? {}
            : await this.fontInventory.verify(await this.fontVerifier.verify(resolved, target?.bundleId ?? null), target);
        return fontLookupResultSchema.parse({ complete: true, fonts: parsed.fonts.map((entry) => entry.status === 'installed' && !verification[entry.requested]
                ? { requested: entry.requested, status: 'unverified', font: entry.font, reason: 'not_found_outside_illustrator' }
                : entry) });
    }
    async searchFonts(input) {
        const query = fontQuerySchema.parse(input.query);
        const cursor = input.cursor === undefined ? null : fontCursorSchema.parse(input.cursor);
        const result = await this.executeHost({ kind: 'read', script: FIND_FONTS_QUERY_SCRIPT,
            params: { needles: fontQueryNeedles(query), byteLimit: FIND_FONTS_QUERY_BYTE_LIMIT } });
        const host = fontQueryHostResultSchema.parse(result.data);
        if (host.truncated) {
            const guidance = host.fonts.length === 0
                ? 'The installed font list is too large for one read, so no query can be answered here: pass the exact PostScript name in post_script_names.'
                : 'Use a longer or more specific query.';
            throw new Error(`FONT_QUERY_TOO_BROAD: the query matches more fonts than one read can return (stopped after ${host.fonts.length} rows, `
                + `${host.scanned} of ${host.total} fonts scanned). ${guidance}`);
        }
        const page = selectFontSearchPage(host.fonts, query, cursor, FONT_SEARCH_PAGE_SIZE);
        const target = this.bridge.applicationTarget?.() ?? null;
        const names = page.fonts.map((font) => font.postScriptName);
        const verification = names.length === 0 ? {}
            : await this.fontInventory.verify(await this.fontVerifier.verify(names, target?.bundleId ?? null), target);
        return fontSearchResultSchema.parse({ complete: true, matched: page.matched,
            fonts: page.fonts.map((font) => verification[font.postScriptName]
                ? { ...font, status: 'installed' }
                : { ...font, status: 'unverified', reason: 'not_found_outside_illustrator' }),
            next_cursor: page.nextCursor });
    }
    async getPathPoints(input) {
        let data;
        try {
            const result = await this.executeHost({ kind: 'read', script: GET_PATH_POINTS_SCRIPT, hostGate: this.reportingReadGate(), params: input });
            data = result.data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new ObjectNotFoundError(detail.uuid ?? input.uuid);
            const message = pathEditErrorMessage(detail);
            if (message !== null)
                throw new Error(message);
            throw error;
        }
        return getPathPointsResultSchema.parse(data);
    }
    async getAreaTextOptions(input) {
        let data;
        try {
            const result = await this.executeHost({ kind: 'read', script: GET_AREA_TEXT_OPTIONS_SCRIPT, hostGate: this.reportingReadGate(), params: input });
            data = result.data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new ObjectNotFoundError(detail.uuid ?? input.targetUuid);
            const message = areaColumnsErrorMessage(detail);
            if (message !== null)
                throw new Error(message);
            throw error;
        }
        return getAreaTextOptionsResultSchema.parse(data);
    }
    async auditTypography(input) {
        if (input.targetUuids !== undefined && new Set(input.targetUuids).size !== input.targetUuids.length) {
            throw new Error('target_uuids must not repeat a UUID.');
        }
        const policies = input.policies ?? ['jp_line_break_v1'];
        const policyError = jpAuditPolicyError(policies, input.justifyBody, input.paragraphShape);
        if (policyError !== null)
            throw new Error(policyError);
        let data;
        try {
            const result = await this.executeHost({
                kind: 'read', script: AUDIT_JAPANESE_TYPOGRAPHY_SCRIPT, hostGate: this.reportingReadGate(),
                params: { expectedDocumentKey: input.expectedDocumentKey, targetUuids: input.targetUuids ?? null,
                    readJustifyBody: policies.includes('jp_justify_body_v1') },
            });
            data = result.data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new ObjectNotFoundError(detail.uuid ?? '');
            const message = jpAuditErrorMessage(detail);
            if (message !== null)
                throw new Error(message);
            throw error;
        }
        return judgeJapaneseTypography(jpAuditHostDataSchema.parse(data), {
            lineStartRelaxations: input.lineStartRelaxations,
            halfwidthPunctuation: input.halfwidthPunctuation,
            protectedTerms: [...new Set(input.protectedTerms)],
            maxFindings: input.maxFindings,
            policies,
            ...(input.justifyBody === undefined ? {} : { justifyBody: input.justifyBody }),
            ...(input.paragraphShape === undefined ? {} : { paragraphShape: input.paragraphShape }),
        });
    }
    async listObjects(input) {
        const filters = {
            type: input.type ?? null,
            layerPath: input.layerPath ?? null,
            bounds: input.bounds ?? null,
            boundsMode: input.boundsMode ?? 'intersects',
        };
        const cursor = input.cursor === undefined ? null : validateCursorPayload(await this.cursorSigner.verify(input.cursor));
        if (cursor && (!documentKeyMatches(input.expectedDocumentKey, cursor.documentKey) || !sameFilters(cursor.filters, filters))) {
            throw new InvalidCursorError();
        }
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: LIST_OBJECTS_SCRIPT, hostGate: this.reportingReadGate(),
                params: {
                    expectedDocumentKey: input.expectedDocumentKey,
                    limit: input.limit,
                    offset: cursor?.offset ?? 0,
                    filters,
                    deadlineMs: READ_SCAN_DEADLINE_MS,
                },
            });
            if (cursor && (cursor.snapshotDigest !== result.data.snapshotDigest || cursor.snapshotCount !== result.data.snapshotCount)) {
                throw new StaleCursorError();
            }
            if (cursor && (cursor.offset >= result.data.snapshotCount || cursor.previousUuid !== result.data.previousUuid)) {
                throw new InvalidCursorError();
            }
            const nextOffset = (cursor?.offset ?? 0) + result.data.items.length;
            const base = {
                document: result.data.document,
                filters,
                limit: input.limit,
                items: result.data.items,
            };
            if (result.data.hasMore) {
                const lastItem = result.data.items.at(-1);
                if (!lastItem)
                    throw new Error('Illustrator returned an invalid paginated object result.');
                const nextCursor = await this.cursorSigner.sign({
                    version: 2,
                    documentKey: result.data.document.key,
                    filters,
                    offset: nextOffset,
                    previousUuid: lastItem.uuid,
                    snapshotDigest: result.data.snapshotDigest,
                    snapshotCount: result.data.snapshotCount,
                });
                return { ...base, hasMore: true, nextCursor, complete: false, absenceConclusive: false };
            }
            return { ...base, hasMore: false, nextCursor: null, complete: true, absenceConclusive: true };
        }
        catch (error) {
            if (error instanceof StaleCursorError)
                throw error;
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                if (cursor)
                    throw new StaleCursorError();
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            }
            const limit = readScanLimitError(detail);
            if (limit !== null)
                throw limit;
            throw error;
        }
    }
    async getObject(input) {
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: GET_OBJECT_SCRIPT, hostGate: this.reportingReadGate(),
                params: { ...input, deadlineMs: READ_SCAN_DEADLINE_MS },
            });
            const data = result.data;
            const raw = data.item.details;
            if (data.item.details.kind === 'text_frame') {
                data.item.details.unreadable = describeUnreadableTextReads(raw.unreadable ?? []);
            }
            return data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new ObjectNotFoundError(detail.uuid ?? input.uuid);
            if (detail?.code === 'OBJECT_ATTRIBUTE_UNREADABLE') {
                const hostError = detail.hostError;
                throw new ObjectAttributeUnreadableError(String(detail.attribute ?? 'unknown'), hostError?.number ?? null);
            }
            const limit = readScanLimitError(detail);
            if (limit !== null)
                throw limit;
            throw error;
        }
    }
    async readMeasuredLineHeights(input) {
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: READ_LINE_HEIGHT_SCRIPT, hostGate: this.reportingReadGate(),
                params: input,
            });
            if (!documentKeyMatches(input.expectedDocumentKey, result.data.document.key) ||
                !hostVersionAdmitted('line_height_read', result.data.document.appVersion)) {
                throw new StaleCursorError('The active document changed during line-height inspection.');
            }
            const reads = new Map(result.data.frames.map((entry) => [entry.uuid, entry.read]));
            if (reads.size !== input.uuids.length || input.uuids.some((uuid) => !reads.has(uuid))) {
                throw new StaleCursorError('The active document changed during line-height inspection.');
            }
            return reads;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new StaleCursorError('The active document changed during line-height inspection.');
            throw error;
        }
    }
    async inspectPreflightImageItems(items, minimumEffectivePpi) {
        if (process.platform === 'win32' && !this.imagePreflightBatchGate) {
            throw new Error('WINDOWS_IMAGE_PREFLIGHT_GATE_MISSING: linked files were not opened.');
        }
        const linkedPaths = [...new Set(items.flatMap((item) => item.file.status === 'available' ? [item.file.value.path] : []))];
        let verdicts = null;
        if (this.imagePreflightBatchGate && linkedPaths.length > 0) {
            try {
                const observed = await this.imagePreflightBatchGate(linkedPaths);
                if (!(observed instanceof Map) || observed.size !== linkedPaths.length) {
                    throw new Error('Linked image attribute observation is incomplete.');
                }
                const local = new Map();
                for (const path of linkedPaths) {
                    const verdict = observed.get(path);
                    if (!verdict || (verdict.status !== 'clear' && verdict.status !== 'missing' &&
                        verdict.status !== 'unavailable') || (verdict.status !== 'clear' && verdict.path !== path) ||
                        (verdict.status === 'unavailable' && (verdict.reason !== 'file_stat_failed' || typeof verdict.message !== 'string'))) {
                        throw new Error('Linked image attribute observation is invalid.');
                    }
                    local.set(path, verdict.status === 'clear' ? { status: 'clear' } : verdict.status === 'missing'
                        ? { status: 'missing', path } : { ...verdict, message: verdict.message.slice(0, 500) });
                }
                verdicts = local;
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                const message = `The linked file attributes were not observed; files were not opened (${detail}).`.slice(0, 500);
                verdicts = new Map(linkedPaths.map((path) => [path,
                    { status: 'unavailable', path, reason: 'file_stat_failed', message }]));
            }
        }
        const inspections = new Map();
        const inspectedItems = [];
        for (const item of items) {
            let inspection = null;
            if (item.file.status === 'available') {
                const path = item.file.value.path;
                inspection = inspections.get(path) ?? null;
                if (inspection === null) {
                    const verdict = verdicts?.get(path);
                    inspection = verdicts === null || verdict?.status === 'clear'
                        ? await this.imageFileInspector.inspect(path)
                        : verdict ?? { status: 'unavailable', path, reason: 'file_stat_failed',
                            message: 'The linked file attributes were not observed; the file was not opened.' };
                    if (inspection.status === 'available')
                        inspections.set(path, inspection);
                }
            }
            inspectedItems.push(createImagePreflightItem(item, inspection, minimumEffectivePpi));
        }
        return inspectedItems;
    }
    async preflightImagesInternal(input, deferContentInspection = false) {
        const documentScope = input.scope.mode === 'document' ? input.scope : null;
        const objectScope = input.scope.mode === 'objects' ? input.scope : null;
        const cursor = documentScope?.cursor !== undefined
            ? validateImagePreflightCursor(await this.cursorSigner.verify(documentScope.cursor))
            : null;
        if (cursor && (!documentKeyMatches(input.expectedDocumentKey, cursor.documentKey) ||
            cursor.minimumEffectivePpi !== input.minimumEffectivePpi)) {
            throw new InvalidCursorError('The image-preflight cursor does not match this request.');
        }
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: IMAGE_PREFLIGHT_SCRIPT, hostGate: this.reportingReadGate(),
                params: {
                    expectedDocumentKey: input.expectedDocumentKey,
                    scopeMode: input.scope.mode,
                    offset: cursor?.offset ?? 0,
                    limit: documentScope?.limit ?? objectScope.uuids.length,
                    uuids: objectScope?.uuids ?? [],
                },
            });
            if (result.data.readIntegrity !== 'verified') {
                throw new Error('Illustrator did not verify image-preflight read integrity.');
            }
            if (cursor && (cursor.snapshotDigest !== result.data.snapshotDigest ||
                cursor.snapshotCount !== result.data.snapshotCount)) {
                throw new StaleCursorError('The image-preflight cursor is stale because the Illustrator image snapshot changed.');
            }
            if (cursor && (cursor.offset >= result.data.snapshotCount ||
                cursor.previousUuid !== result.data.previousUuid)) {
                throw new InvalidCursorError('The image-preflight cursor position is invalid.');
            }
            const inspectedItems = deferContentInspection
                ? result.data.items.map(item => createImagePreflightItem(item, null, input.minimumEffectivePpi))
                : await this.inspectPreflightImageItems(result.data.items, input.minimumEffectivePpi);
            const eligibility = new Map(result.data.items.map(item => [item.uuid, {
                    visible: item.effectiveVisible.status === 'available' ? item.effectiveVisible.value : null,
                    printable: item.effectivePrintable.status === 'available' ? item.effectivePrintable.value : null,
                }]));
            const base = {
                document: result.data.document,
                scopeNote: PREFLIGHT_SCOPE_NOTE,
                threshold: { minimumEffectivePpi: input.minimumEffectivePpi },
                scope: documentScope !== null
                    ? { mode: 'document' }
                    : { mode: 'objects', uuids: objectScope.uuids },
                items: inspectedItems,
                warningCount: inspectedItems.reduce((total, item) => total + item.warnings.length, 0),
            };
            if (documentScope !== null && result.data.hasMore) {
                const nextOffset = (cursor?.offset ?? 0) + result.data.items.length;
                const lastItem = result.data.items.at(-1);
                if (!lastItem)
                    throw new Error('Illustrator returned an invalid paginated image-preflight result.');
                const nextCursor = await this.cursorSigner.sign({
                    version: 1,
                    kind: 'image_preflight',
                    documentKey: result.data.document.key,
                    minimumEffectivePpi: input.minimumEffectivePpi,
                    offset: nextOffset,
                    previousUuid: lastItem.uuid,
                    snapshotDigest: result.data.snapshotDigest,
                    snapshotCount: result.data.snapshotCount,
                });
                return {
                    page: { ...base, hasMore: true, nextCursor, complete: false, absenceConclusive: false },
                    hostItems: result.data.items,
                    snapshotDigest: result.data.snapshotDigest,
                    snapshotCount: result.data.snapshotCount,
                    eligibility,
                };
            }
            return {
                page: { ...base, hasMore: false, nextCursor: null, complete: true, absenceConclusive: true },
                hostItems: result.data.items,
                snapshotDigest: result.data.snapshotDigest,
                snapshotCount: result.data.snapshotCount,
                eligibility,
            };
        }
        catch (error) {
            if (error instanceof StaleCursorError)
                throw error;
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                if (cursor)
                    throw new StaleCursorError('The image-preflight cursor document is stale.');
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            }
            if (detail?.code === 'OBJECT_NOT_FOUND')
                throw new ObjectNotFoundError(detail.uuid ?? 'unknown');
            if (detail?.code === 'IMAGE_OBJECT_REQUIRED') {
                throw new ImageObjectRequiredError(detail.uuid ?? 'unknown', detail.type ?? 'unknown');
            }
            if (detail?.code === 'IMAGE_SNAPSHOT_CHANGED') {
                if (cursor)
                    throw new StaleCursorError('The Illustrator image snapshot changed during the read.');
                throw new Error('The Illustrator image snapshot changed during the read; no partial result was returned.');
            }
            throw error;
        }
    }
    async preflightImages(input) {
        return (await this.preflightImagesInternal(input)).page;
    }
    async preflightPrint(input) {
        try {
            const first = await this.executeHost({
                kind: 'read',
                script: PRINT_PREFLIGHT_SCRIPT, hostGate: this.reportingReadGate(),
                params: {
                    expectedDocumentKey: input.expectedDocumentKey,
                    conditions: input.conditions,
                    collectFindings: true,
                },
            });
            if (first.data.scan.readIntegrity !== 'verified') {
                throw new Error('Illustrator did not verify print-preflight read integrity.');
            }
            const imageItems = [];
            const batchImages = this.imagePreflightBatchGate !== undefined || process.platform === 'win32';
            const hostImages = [];
            const imageEligibility = new Map();
            let imageComplete = first.data.scan.totalImages === 0;
            let cursor;
            while (!imageComplete && imageItems.length < PRINT_PREFLIGHT_LIMITS.images) {
                const remaining = PRINT_PREFLIGHT_LIMITS.images - imageItems.length;
                const imagePage = await this.preflightImagesInternal({
                    expectedDocumentKey: input.expectedDocumentKey,
                    minimumEffectivePpi: input.conditions.minimumEffectivePpi,
                    scope: {
                        mode: 'document',
                        limit: Math.min(50, remaining),
                        ...(cursor === undefined ? {} : { cursor }),
                    },
                }, batchImages);
                if (imagePage.snapshotDigest !== first.data.scan.imageSnapshotDigest ||
                    imagePage.snapshotCount !== first.data.scan.totalImages) {
                    throw new StaleCursorError('The Illustrator image snapshot changed during print preflight.');
                }
                const page = imagePage.page;
                if (page.document.key !== first.data.document.key) {
                    throw new StaleCursorError('The active document changed during print preflight.');
                }
                imageItems.push(...page.items);
                if (batchImages)
                    hostImages.push(...imagePage.hostItems);
                for (const [uuid, state] of imagePage.eligibility)
                    imageEligibility.set(uuid, state);
                if (!page.hasMore)
                    imageComplete = true;
                else
                    cursor = page.nextCursor;
            }
            if (imageComplete && imageItems.length !== first.data.scan.totalImages) {
                throw new StaleCursorError('The Illustrator image count changed during print preflight.');
            }
            if (batchImages && hostImages.length > 0) {
                imageItems.splice(0, imageItems.length, ...await this.inspectPreflightImageItems(hostImages, input.conditions.minimumEffectivePpi));
            }
            const final = await this.executeHost({
                kind: 'read',
                script: PRINT_PREFLIGHT_SCRIPT, hostGate: this.reportingReadGate(),
                params: {
                    expectedDocumentKey: input.expectedDocumentKey,
                    conditions: input.conditions,
                    collectFindings: false,
                },
            });
            if (final.data.scan.readIntegrity !== 'verified' ||
                first.data.scan.snapshotDigest !== final.data.scan.snapshotDigest ||
                first.data.scan.imageSnapshotDigest !== final.data.scan.imageSnapshotDigest ||
                first.data.scan.totalPageItems !== final.data.scan.totalPageItems ||
                first.data.scan.totalImages !== final.data.scan.totalImages) {
                throw new StaleCursorError('The Illustrator print-preflight snapshot changed during inspection.');
            }
            return createPrintPreflightResult(first.data, imageItems, imageComplete, input.conditions, imageEligibility);
        }
        catch (error) {
            if (error instanceof StaleCursorError)
                throw error;
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            }
            if (detail?.code === 'PRINT_PREFLIGHT_SNAPSHOT_CHANGED') {
                throw new StaleCursorError('The Illustrator print-preflight snapshot changed during the read.');
            }
            throw error;
        }
    }
    async captureStructureSnapshot(input) {
        return summarizeStructureSnapshot(await this.captureStructureSnapshotInternal(input.expectedDocumentKey));
    }
    async captureStructureSnapshotInternal(expectedDocumentKey) {
        return this.#structureSnapshots.add(await this.readStructureHostData(expectedDocumentKey), new Date().toISOString());
    }
    structureReadError(error, expectedDocumentKey) {
        const detail = parseMcpError(error);
        if (detail?.code === 'DOCUMENT_MISMATCH')
            return new DocumentMismatchError(detail.expected ?? expectedDocumentKey, detail.actual ?? '');
        if (detail?.code === 'STRUCTURE_SNAPSHOT_CHANGED')
            return new StructureSnapshotChangedError();
        if (detail?.code === 'STRUCTURE_SNAPSHOT_TOO_LARGE') {
            return new StructureSnapshotTooLargeError(detail.collection === 'artboards' ? 'artboards' : 'pageItems', detail.total ?? 0, detail.limit ?? 0);
        }
        if (detail?.code === 'STRUCTURE_PAGE_PLAN_TOO_LARGE') {
            return detail.reason === 'record_too_large'
                ? new StructureSnapshotPagePlanError('record_too_large', `one ${String(detail.collection)} record at position ${String(detail.offset)} serializes to ${String(detail.bytes)} bytes, above the ${String(detail.limit)} byte page budget.`)
                : new StructureSnapshotPagePlanError('too_many_pages', `the document needs ${String(detail.pages)} pages, above the limit of ${String(detail.limit)}.`);
        }
        return error;
    }
    async readStructureDigest(expectedDocumentKey, options = {}) {
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: options.captureBackupBaseline ? `${CAPTURE_STRUCTURE_SNAPSHOT_SCRIPT}\n${BACKUP_CAPTURE_BASELINE_JSX}` : CAPTURE_STRUCTURE_SNAPSHOT_SCRIPT,
                hostGate: this.reportingReadGate(),
                params: {
                    expectedDocumentKey,
                    mode: 'digest',
                    ...(options.maxPageItems === undefined ? {} : { maxPageItems: options.maxPageItems }),
                },
                ...(options.hostGate === undefined ? {} : { hostGate: options.hostGate }),
            });
            const data = result.data;
            if (data.scan.readIntegrity !== 'verified') {
                throw new Error('Illustrator did not verify structure-snapshot read integrity.');
            }
            if (!documentKeyMatches(expectedDocumentKey, data.document.key)) {
                throw new DocumentMismatchError(expectedDocumentKey, data.document.key);
            }
            if (data.scan.totalPageItems > STRUCTURE_SNAPSHOT_LIMITS.pageItems ||
                data.scan.artboardCount > STRUCTURE_SNAPSHOT_LIMITS.artboards ||
                data.pages.length > STRUCTURE_PAGE_LIMITS.maxPages) {
                throw new Error('Illustrator returned an inconsistent structure snapshot.');
            }
            assertStructurePagePlan(data);
            return data;
        }
        catch (error) {
            throw this.structureReadError(error, expectedDocumentKey);
        }
    }
    async readStructureSnapshotPaged(expectedDocumentKey, digest) {
        const artboards = [];
        const items = [];
        for (const page of digest.pages) {
            let data;
            try {
                const result = await this.executeHost({
                    kind: 'read',
                    script: CAPTURE_STRUCTURE_SNAPSHOT_SCRIPT, hostGate: this.reportingReadGate(),
                    params: {
                        expectedDocumentKey,
                        mode: 'page',
                        collection: page.collection,
                        offset: page.offset,
                        count: page.count,
                    },
                });
                data = result.data;
            }
            catch (error) {
                throw this.structureReadError(error, expectedDocumentKey);
            }
            if (!documentKeyMatches(expectedDocumentKey, data.document.key)) {
                throw new DocumentMismatchError(expectedDocumentKey, data.document.key);
            }
            if (data.digest !== page.digest || data.collection !== page.collection || data.offset !== page.offset ||
                data.count !== page.count || data.totalPageItems !== digest.scan.totalPageItems ||
                data.artboardCount !== digest.scan.artboardCount) {
                throw new StructureSnapshotChangedError();
            }
            const served = page.collection === 'artboards' ? data.artboards : data.items;
            if (served.length !== page.count)
                throw new StructureSnapshotChangedError();
            if (page.collection === 'artboards')
                artboards.push(...data.artboards);
            else
                items.push(...data.items);
        }
        if (artboards.length !== digest.scan.artboardCount || items.length !== digest.scan.totalPageItems) {
            throw new StructureSnapshotChangedError();
        }
        return {
            document: digest.document,
            artboards,
            items,
            scan: {
                totalPageItems: digest.scan.totalPageItems,
                readIntegrity: 'verified',
                snapshotDigest: digest.scan.snapshotDigest,
            },
        };
    }
    async readStructureHostData(expectedDocumentKey, hostGate) {
        const digest = await this.readStructureDigest(expectedDocumentKey, hostGate === undefined ? {} : { hostGate });
        return await this.readStructureSnapshotPaged(expectedDocumentKey, digest);
    }
    async extractDesignTokens(input) {
        const first = await this.readStructureHostData(input.expectedDocumentKey);
        const swatches = await this.listSwatches({ expectedDocumentKey: input.expectedDocumentKey });
        if (swatches.document.key !== first.document.key || swatches.document.appVersion !== first.document.appVersion) {
            throw new StaleCursorError('The Illustrator document changed during design-token extraction.');
        }
        const textDetails = new Map();
        const unreadableTextFrames = [];
        const textFrames = first.items.filter((item) => item.type === 'TextFrame');
        const measuredFrames = textFrames.slice(0, DESIGN_ANALYSIS_LIMITS.textFrameDetailReads);
        for (const frame of measuredFrames) {
            let detail;
            try {
                detail = await this.getObject({ expectedDocumentKey: input.expectedDocumentKey, uuid: frame.uuid });
            }
            catch (error) {
                if (error instanceof ObjectNotFoundError) {
                    throw new StaleCursorError('The Illustrator document changed during design-token extraction.');
                }
                if (error instanceof ObjectAttributeUnreadableError) {
                    unreadableTextFrames.push({ uuid: frame.uuid, name: frame.name, attributes: [error.attribute] });
                    continue;
                }
                throw error;
            }
            if (detail.item.details.kind !== 'text_frame') {
                throw new StaleCursorError('The Illustrator document changed during design-token extraction.');
            }
            if (detail.document.key !== first.document.key || detail.document.appVersion !== first.document.appVersion) {
                throw new StaleCursorError('The Illustrator document changed during design-token extraction.');
            }
            textDetails.set(frame.uuid, detail.item.details);
            if (detail.item.details.unreadable.length > 0) {
                const attributes = [...new Set(detail.item.details.unreadable.map((read) => read.attribute))].slice(0, 8);
                unreadableTextFrames.push({ uuid: frame.uuid, name: frame.name, attributes });
            }
        }
        const uuids = measuredFrames.map((frame) => frame.uuid).filter((uuid) => textDetails.has(uuid));
        const beforeObservation = await this.hostProfileProbe.observe();
        const lineHeightBefore = isMeasuredLineHeightProfile(beforeObservation, first.document.appVersion)
            ? await this.readMeasuredLineHeights({ expectedDocumentKey: input.expectedDocumentKey, uuids })
            : null;
        let lineHeightAfter = null;
        let lineHeightStableProfile = false;
        if (lineHeightBefore !== null) {
            const secondObservation = await this.hostProfileProbe.observe();
            if (isMeasuredLineHeightProfile(secondObservation, first.document.appVersion)) {
                lineHeightAfter = await this.readMeasuredLineHeights({ expectedDocumentKey: input.expectedDocumentKey, uuids });
                const afterObservation = await this.hostProfileProbe.observe();
                lineHeightStableProfile = isMeasuredLineHeightProfile(afterObservation, first.document.appVersion);
            }
        }
        const rawLineHeightChanged = lineHeightBefore !== null && lineHeightAfter !== null &&
            JSON.stringify([...lineHeightBefore]) !== JSON.stringify([...lineHeightAfter]);
        const final = await this.readStructureHostData(input.expectedDocumentKey);
        if (final.scan.snapshotDigest !== first.scan.snapshotDigest ||
            final.scan.totalPageItems !== first.scan.totalPageItems ||
            final.document.key !== first.document.key || final.document.appVersion !== first.document.appVersion) {
            throw new StaleCursorError('The Illustrator document changed during design-token extraction.');
        }
        if (rawLineHeightChanged)
            throw new StaleCursorError('The active document changed during line-height inspection.');
        const lineHeightReads = new Map();
        if (lineHeightStableProfile && lineHeightAfter !== null)
            for (const [uuid, read] of lineHeightAfter)
                lineHeightReads.set(uuid, read);
        return createDesignTokens({ snapshot: first, swatches, textDetails, unreadableTextFrames, format: input.format,
            lineHeightForeground: lineHeightStableProfile, lineHeightReads,
            lineHeightUnavailableReason: hostVersionAdmitted('line_height_read', first.document.appVersion)
                ? 'foreground_profile_required' : 'unsupported_host_version' });
    }
    async readColorReplacementState(expectedDocumentKey, match, includeTextDetails) {
        validateColorMatch(match);
        const first = await this.readStructureHostData(expectedDocumentKey);
        const firstSwatches = await this.listSwatches({ expectedDocumentKey });
        if (!documentKeyMatches(expectedDocumentKey, firstSwatches.document.key) || firstSwatches.document.key !== first.document.key) {
            throw new StaleCursorError('The active document changed during color-usage inspection.');
        }
        const initialUsages = findColorUsages(first, firstSwatches, match);
        const textDetails = new Map();
        if (includeTextDetails) {
            const textUuids = [...new Set(initialUsages.filter((entry) => entry.target_type === 'TextFrame' && entry.target_uuid !== null)
                    .map((entry) => entry.target_uuid))];
            for (const uuid of textUuids) {
                let detail;
                try {
                    detail = await this.getObject({ expectedDocumentKey, uuid });
                }
                catch (error) {
                    if (error instanceof ObjectNotFoundError)
                        throw new StaleCursorError('The Illustrator document changed during color replacement planning.');
                    if (error instanceof ObjectAttributeUnreadableError)
                        continue;
                    throw error;
                }
                if (detail.item.details.kind !== 'text_frame')
                    throw new StaleCursorError('The Illustrator document changed during color replacement planning.');
                textDetails.set(uuid, detail.item.details);
            }
        }
        const final = await this.readStructureHostData(expectedDocumentKey);
        const finalSwatches = await this.listSwatches({ expectedDocumentKey });
        assertConsistentColorRead(first, final, firstSwatches, finalSwatches);
        const usages = includeTextDetails ? findColorUsages(first, firstSwatches, match, textDetails) : initialUsages;
        return { snapshot: first, swatches: firstSwatches, usages, textDetails,
            digest: colorReplacementSnapshotDigest(first, firstSwatches) };
    }
    async findColorUsages(input) {
        const requestDigest = canonicalSha256(input.match);
        let offset = 0;
        let cursorSnapshotDigest = null;
        if (input.cursor !== undefined) {
            let payload;
            try {
                payload = await this.cursorSigner.verify(input.cursor);
            }
            catch (_error) {
                throw new InvalidCursorError('The color-usage cursor is invalid.');
            }
            if (typeof payload !== 'object' || payload === null)
                throw new InvalidCursorError('The color-usage cursor is invalid.');
            const value = payload;
            if (value.kind !== 'color_usages' || value.version !== 1 || value.requestDigest !== requestDigest ||
                typeof value.documentKey !== 'string' || !documentKeyMatches(input.expectedDocumentKey, value.documentKey) ||
                typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 1 ||
                typeof value.snapshotDigest !== 'string')
                throw new InvalidCursorError('The color-usage cursor does not match this request.');
            offset = value.offset;
            cursorSnapshotDigest = value.snapshotDigest;
        }
        const state = await this.readColorReplacementState(input.expectedDocumentKey, input.match, true);
        if (cursorSnapshotDigest !== null && cursorSnapshotDigest !== state.digest) {
            throw new StaleCursorError('The color-usage cursor is stale because the Illustrator color snapshot changed.');
        }
        if (offset >= state.usages.length && state.usages.length !== 0)
            throw new InvalidCursorError('The color-usage cursor position is invalid.');
        const usages = state.usages.slice(offset, offset + input.limit);
        const nextOffset = offset + usages.length;
        const base = { document: state.snapshot.document, limit: input.limit, usages,
            matched_usage_count: state.usages.length };
        if (nextOffset < state.usages.length) {
            const nextCursor = await this.cursorSigner.sign({ version: 1, kind: 'color_usages', documentKey: state.snapshot.document.key,
                requestDigest, snapshotDigest: state.digest, offset: nextOffset });
            return { ...base, has_more: true, next_cursor: nextCursor, complete: false, absence_conclusive: false };
        }
        return { ...base, has_more: false, next_cursor: null, complete: true, absence_conclusive: true };
    }
    async planColorReplacement(input) {
        const requestDigest = canonicalSha256({ match: input.match, replacement: input.replacement });
        let offset = 0;
        let cursorSnapshotDigest = null;
        if (input.cursor !== undefined) {
            let payload;
            try {
                payload = await this.cursorSigner.verify(input.cursor);
            }
            catch (_error) {
                throw new InvalidCursorError('The color-replacement cursor is invalid.');
            }
            if (typeof payload !== 'object' || payload === null)
                throw new InvalidCursorError('The color-replacement cursor is invalid.');
            const value = payload;
            if (value.kind !== 'color_replacement' || value.version !== 1 || value.requestDigest !== requestDigest ||
                typeof value.documentKey !== 'string' || !documentKeyMatches(input.expectedDocumentKey, value.documentKey) ||
                typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 1 ||
                typeof value.snapshotDigest !== 'string')
                throw new InvalidCursorError('The color-replacement cursor does not match this request.');
            offset = value.offset;
            cursorSnapshotDigest = value.snapshotDigest;
        }
        const state = await this.readColorReplacementState(input.expectedDocumentKey, input.match, true);
        if (cursorSnapshotDigest !== null && cursorSnapshotDigest !== state.digest) {
            throw new StaleCursorError('The color-replacement cursor is stale because the Illustrator color snapshot changed.');
        }
        const entries = buildReplacementPlanEntries(state.snapshot, state.swatches, input.match, input.replacement, state.usages, state.textDetails);
        if (offset >= entries.length && entries.length !== 0)
            throw new InvalidCursorError('The color-replacement cursor position is invalid.');
        const page = entries.slice(offset, offset + input.limit);
        const steps = page.flatMap((entry) => entry.step === null ? [] : [entry.step]);
        const unsupported = page.flatMap((entry) => entry.unsupported);
        const nextOffset = offset + page.length;
        const hasMore = nextOffset < entries.length;
        const nextCursor = hasMore ? await this.cursorSigner.sign({ version: 1, kind: 'color_replacement',
            documentKey: state.snapshot.document.key, requestDigest, snapshotDigest: state.digest, offset: nextOffset }) : null;
        const notes = [
            'The returned request is plan-only. Call illustrator_mutate_batch with apply=false, review its exact before/after plan, then request separate live P0 approval before any apply.',
            'Gradient-stop and swatch-resource writes remain fail-closed because no resource-scoped CAS/verify/rollback adapter exists.',
        ];
        if (steps.length === 1)
            notes.push('This page has one supported target; mutate_batch requires at least two distinct targets, so batch_request is null. Use the existing single-target adapter or choose a page with at least two targets.');
        return {
            document: state.snapshot.document,
            matched_usage_count: state.usages.length,
            page_offset: offset,
            page_entry_count: page.length,
            has_more: hasMore,
            next_cursor: nextCursor,
            batch_request: steps.length >= 2 ? { expected_document_key: state.snapshot.document.key, steps, apply: false } : null,
            supported_step_count: steps.length,
            unsupported,
            notes,
        };
    }
    async checkTextConsistency(input) {
        return checkTextConsistency(await this.readStructureHostData(input.expectedDocumentKey));
    }
    async checkContrast(input) {
        if (input.mode === 'pairs')
            return computeContrastPairs(input.expectedDocumentKey, input.pairs);
        const before = await this.hostProfileProbe.observe();
        if (before.profile !== 'foreground')
            return contrastAutoDetectUnsupportedProfile(input.expectedDocumentKey, before, false);
        const snapshot = await this.readStructureHostData(input.expectedDocumentKey);
        const layers = await this.listLayers();
        if (!documentKeyMatches(input.expectedDocumentKey, layers.document.key))
            throw new DocumentMismatchError(input.expectedDocumentKey, layers.document.key);
        const clipFlags = await this.readClipFlags(input.expectedDocumentKey);
        if (clipFlags.totalPageItems !== snapshot.scan.totalPageItems || clipFlags.items.length !== snapshot.items.length ||
            clipFlags.items.some((flag, index) => flag.uuid !== snapshot.items[index]?.uuid || flag.type !== snapshot.items[index]?.type)) {
            throw new StaleCursorError('The Illustrator document changed during contrast auto_detect.');
        }
        const after = await this.hostProfileProbe.observe();
        if (after.profile !== 'foreground')
            return contrastAutoDetectUnsupportedProfile(input.expectedDocumentKey, after, true);
        return detectContrastOverlaps({ snapshot, layers, clipFlags, observed: { before, after } });
    }
    async capturePreview(input) {
        return await capturePreview({
            bridge: this.bridge,
            hostProfileProbe: this.hostProfileProbe,
            activator: this.hostApplicationActivator,
            previewRoot: join(this.exportStore.stateRootPath, 'previews'),
        }, input);
    }
    async renderArtboards(input) {
        return await renderArtboards({
            bridge: this.bridge,
            hostProfileProbe: this.hostProfileProbe,
            store: this.#renderSets,
            renderRoot: join(this.exportStore.stateRootPath, 'renders'),
        }, input);
    }
    async extractText(input) {
        return await extractText(this.bridge, this.hostProfileProbe, input, this.hostApplicationActivator);
    }
    async decodeBarcodeRaster(input) {
        return await decodeBarcodeRaster({
            bridge: this.bridge,
            hostProfileProbe: this.hostProfileProbe,
            previewRoot: join(this.exportStore.stateRootPath, 'previews'),
        }, input);
    }
    async decodeQrRaster(input) {
        return await decodeQrRaster({
            bridge: this.bridge,
            hostProfileProbe: this.hostProfileProbe,
            previewRoot: join(this.exportStore.stateRootPath, 'previews'),
        }, input);
    }
    async analyzeDisplaySpacing(input) {
        return await analyzeDisplaySpacing({
            bridge: this.bridge,
            hostProfileProbe: this.hostProfileProbe,
            reportingReadGate: this.reportingReadGate(),
            previewRoot: join(this.exportStore.stateRootPath, 'previews'),
        }, input);
    }
    async readClipFlags(expectedDocumentKey) {
        try {
            const result = await this.executeHost({ kind: 'read', script: CLIP_FLAGS_SCRIPT, hostGate: this.reportingReadGate(), params: { expectedDocumentKey } });
            if (!documentKeyMatches(expectedDocumentKey, result.data.document.key))
                throw new DocumentMismatchError(expectedDocumentKey, result.data.document.key);
            return result.data;
        }
        catch (error) {
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (detail?.code === 'STRUCTURE_SNAPSHOT_TOO_LARGE') {
                throw new StructureSnapshotTooLargeError('pageItems', detail.total ?? 0, detail.limit ?? 0);
            }
            throw error;
        }
    }
    async diffStructure(input) {
        const base = this.#structureSnapshots.require(input.baseSnapshotId);
        let target;
        if (input.target.mode === 'live') {
            target = await this.captureStructureSnapshotInternal(input.expectedDocumentKey);
        }
        else {
            target = this.#structureSnapshots.require(input.target.snapshotId);
            if (!documentKeyMatches(input.expectedDocumentKey, target.document.key)) {
                throw new DocumentMismatchError(input.expectedDocumentKey, target.document.key);
            }
        }
        const record = this.#structureDiffs.add(computeStructureDiff({
            base,
            target,
            targetMode: input.target.mode,
            tolerancePt: input.tolerancePt,
            scope: input.scope,
            computedAt: new Date().toISOString(),
        }));
        return pageStructureDiff(record, 0, input.limit, (payload) => this.cursorSigner.sign(payload));
    }
    async readStructureDiff(input) {
        let offset = 0;
        if (input.cursor !== undefined) {
            let payload;
            try {
                payload = validateStructureDiffCursor(await this.cursorSigner.verify(input.cursor));
            }
            catch (error) {
                if (error instanceof InvalidCursorError)
                    throw error;
                throw new InvalidCursorError('The structure-diff cursor is invalid.');
            }
            if (payload.diffId !== input.diffId)
                throw new InvalidCursorError('The structure-diff cursor belongs to a different diff.');
            offset = payload.offset;
            const record = this.#structureDiffs.require(input.diffId);
            if (payload.entryCount !== record.entries.length || offset >= record.entries.length) {
                throw new InvalidCursorError('The structure-diff cursor position is invalid.');
            }
            return pageStructureDiff(record, offset, input.limit, (next) => this.cursorSigner.sign(next));
        }
        const record = this.#structureDiffs.require(input.diffId);
        return pageStructureDiff(record, offset, input.limit, (next) => this.cursorSigner.sign(next));
    }
    async commandInactive(commandId) {
        if (typeof this.bridge.commandExecutionState !== 'function')
            return false;
        return await this.bridge.commandExecutionState(commandId) === 'inactive';
    }
    async assertSameBackupSession(session) {
        const current = await this.backupStore.readSession(session.backupId);
        if (current === null)
            throw new BackupSessionGoneError(session.backupId);
        if (!isDeepStrictEqual(backupSessionSchema.parse(current), backupSessionSchema.parse(session))) {
            throw new Error('The backup session binding changed; it stays unresolved.');
        }
    }
    async releaseLeaseOnEvidence(session, inventory) {
        await this.assertSameBackupSession(session);
        if (inventory.documents.length !== 0)
            return false;
        if (session.version === 2) {
            if (!Number.isSafeInteger(inventory.documentCount) || inventory.documentCount < 0 ||
                !Array.isArray(inventory.allDocuments) || inventory.allDocuments.length !== inventory.documentCount) {
                throw new Error('Illustrator returned an incomplete document inventory; the backup session stays unresolved.');
            }
            const documents = inventory.allDocuments.map((document) => hostDocumentIdentitySchema.parse(document));
            if (documentsOutsideBackupBaseline(session, documents).length > 0)
                return false;
        }
        if (!(await this.commandInactive(session.openCommandId))) {
            throw new Error(`The host open command ${session.openCommandId} is not proven inactive; the backup session stays unresolved.`);
        }
        await this.backupStore.releaseSession(session.backupId);
        return true;
    }
    async createBackup(input) {
        const spoolHolder = { spool: null };
        try {
            return await this.runCreateBackup(input, spoolHolder);
        }
        finally {
            await spoolHolder.spool?.dispose();
        }
    }
    async readStructureStreamFor(expectedDocumentKey, spoolHolder, labelPrefix, hostGate, captureBackupBaseline = false) {
        spoolHolder.spool ??= await StructureSpool.create(this.backupStore.stateRootPath);
        const spool = spoolHolder.spool;
        const host = {
            newFile: (label) => spool.newFile(`${labelPrefix}-${label}`),
            call: async (file, position) => {
                try {
                    const result = await this.executeHost({
                        kind: 'read',
                        script: captureBackupBaseline ? `${CAPTURE_STRUCTURE_STREAM_SCRIPT}\n${BACKUP_CAPTURE_BASELINE_JSX}` : CAPTURE_STRUCTURE_STREAM_SCRIPT,
                        params: {
                            expectedDocumentKey, spoolPath: file.path, position,
                            budgetMs: STRUCTURE_STREAM_BUDGET_MS, deadlineMs: STRUCTURE_STREAM_DEADLINE_MS,
                        },
                        hostGate: hostGate ?? this.reportingReadGate(),
                    });
                    return result.data;
                }
                catch (error) {
                    const scanLimit = readScanLimitError(parseMcpError(error));
                    if (scanLimit !== null)
                        throw scanLimit;
                    throw this.structureReadError(error, expectedDocumentKey);
                }
            },
        };
        return await readStructureStream(host, labelPrefix);
    }
    async runCreateBackup(input, spoolHolder) {
        const files = { backupPath: null, restoreTestPath: null };
        let stage = 'read_source';
        let sessionId = null;
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', stage, message, commandId, files, sessionId });
        const failed = (reason, message, deltas = [], cause = null) => ({ outcome: 'failed', reason, stage, message, files, deltas, ...(cause === null ? {} : { cause }) });
        const asIndeterminate = (error) => {
            if (error instanceof IndeterminateExecutionError)
                return indeterminate(error.message, error.commandId);
            return indeterminate(error instanceof Error ? error.message : String(error));
        };
        const leaseGuard = async () => { await this.#leaseGuard.assertNoUnresolvedSession(); };
        const baselineHolder = { value: null };
        const sourceGate = {
            beforeHost: leaseGuard,
            afterHost: async ({ commandId, data }) => {
                const captured = backupBaselineHostDataSchema.parse(data.backupBaseline);
                baselineHolder.value = { ...captured, commandId };
            },
        };
        let source = null;
        let sourceStream = null;
        const rejectTooLarge = (message) => ({ outcome: 'rejected', reason: 'document_too_large', message: `${message} Nothing was copied or opened. ${LARGE_DOCUMENT_WORKAROUND}`, document: null });
        try {
            source = await this.readStructureDigest(input.expectedDocumentKey, {
                hostGate: sourceGate,
                captureBackupBaseline: true,
                maxPageItems: BACKUP_MAX_PAGE_ITEMS,
            });
        }
        catch (error) {
            if (error instanceof BackupSessionUnresolvedError || error instanceof ExportSessionUnresolvedError || error instanceof UnresolvedLeaseError)
                throw error;
            if (error instanceof IndeterminateExecutionError)
                return asIndeterminate(error);
            if (error instanceof DocumentMismatchError) {
                return { outcome: 'rejected', reason: 'document_key_mismatch', message: error.message, document: null };
            }
            if (error instanceof StructureSnapshotTooLargeError && error.collection === 'pageItems' && error.total <= BACKUP_STREAM_MAX_PAGE_ITEMS) {
                try {
                    sourceStream = await this.readStructureStreamFor(input.expectedDocumentKey, spoolHolder, 'source', sourceGate, true);
                }
                catch (streamError) {
                    if (streamError instanceof BackupSessionUnresolvedError || streamError instanceof ExportSessionUnresolvedError || streamError instanceof UnresolvedLeaseError)
                        throw streamError;
                    if (streamError instanceof IndeterminateExecutionError)
                        return asIndeterminate(streamError);
                    if (streamError instanceof DocumentMismatchError || streamError instanceof StructureSnapshotChangedError) {
                        return { outcome: 'rejected', reason: 'document_key_mismatch', message: streamError.message, document: null };
                    }
                    if (streamError instanceof StructureStreamError || streamError instanceof ReadScanLimitError) {
                        return rejectTooLarge(`The structure of this ${error.total}-item document could not be read completely for a backup (${streamError.message}).`);
                    }
                    throw streamError;
                }
            }
            else if (error instanceof StructureSnapshotTooLargeError || error instanceof StructureSnapshotPagePlanError) {
                return { outcome: 'rejected', reason: 'document_too_large', message: backupTooLargeMessage(error), document: null };
            }
            else if (error instanceof StructureSnapshotChangedError) {
                return { outcome: 'rejected', reason: 'document_key_mismatch', message: error.message, document: null };
            }
            else {
                throw error;
            }
        }
        const document = (source ?? sourceStream).document;
        if (baselineHolder.value === null)
            throw new Error('The source read did not return a completed backup baseline.');
        const capturedBaseline = baselineHolder.value;
        const sourceItemCount = source !== null ? source.scan.totalPageItems : sourceStream.items.length;
        const sourceArtboardCount = source !== null ? source.scan.artboardCount : sourceStream.artboards.length;
        const admittedKey = document.key;
        if (document.mutationProfile !== 'saved_file' || document.path === null || document.fileRevision === null) {
            return {
                outcome: 'rejected',
                reason: 'document_not_admitted',
                message: document.mutationBlockedReason ?? BACKUP_REQUIRES_SAVED_FILE_MESSAGE,
                document,
            };
        }
        const sourcePath = document.path;
        const sourceFileRevision = document.fileRevision;
        let sourceFile;
        let backupRoot;
        try {
            sourceFile = await inspectSourceFile(sourcePath);
            await this.backupStore.ensure();
            backupRoot = input.backupRoot === undefined
                ? await resolveBackupRoot(this.backupStore.defaultBackupRoot())
                : await resolveBackupRoot(input.backupRoot);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError) {
                return { outcome: 'rejected', reason: error.reason, message: error.message, document };
            }
            throw error;
        }
        return await withBackupRootScope(backupRoot, async (rootScope) => {
            const backupId = newBackupId();
            const backupPath = join(backupRoot, backupFileName(backupId, sourceFile.path));
            const restoreTestPath = join(backupRoot, restoreTestFileName(backupId, sourceFile.path));
            stage = 'copy_backup';
            let copied;
            try {
                copied = await copyFileExclusive(sourceFile.path, backupPath, sourceFile.identity);
                files.backupPath = backupPath;
            }
            catch (error) {
                if (copyErrorCreatedDestination(error))
                    files.backupPath = backupPath;
                if (error instanceof BackupCopyError)
                    return failed('copy_mismatch', error.message);
                return asIndeterminate(error);
            }
            stage = 'copy_restore_test';
            let restoreCopy;
            try {
                restoreCopy = await copyFileExclusive(backupPath, restoreTestPath, copied.identity);
                files.restoreTestPath = restoreTestPath;
                if (restoreCopy.sha256 !== copied.sha256 || restoreCopy.bytes !== copied.bytes) {
                    return failed('copy_mismatch', 'The restore-test copy does not match the backup copy.');
                }
            }
            catch (error) {
                if (copyErrorCreatedDestination(error))
                    files.restoreTestPath = restoreTestPath;
                if (error instanceof BackupCopyError)
                    return failed('copy_mismatch', error.message);
                return asIndeterminate(error);
            }
            stage = 'open_session';
            let session = null;
            let opened;
            try {
                const result = await this.executeHost({
                    kind: 'read',
                    script: BACKUP_OPEN_RESTORE_TEST_SCRIPT,
                    params: { expectedDocumentKey: admittedKey, restoreTestPath, restoreTestPathForms: hostPathForms(restoreTestPath) },
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.#leaseGuard.assertNoUnresolvedSession();
                            await rootScope.assertStable();
                            await verifyTrackedFile(restoreTestPath, restoreCopy.identity, copied.sha256);
                            const lease = {
                                version: 2,
                                backupId,
                                documentKey: input.expectedDocumentKey,
                                sourcePath: sourceFile.path,
                                backupPath,
                                backupIdentity: serializeFileIdentity(copied.identity),
                                restoreTestPath,
                                restoreTestIdentity: serializeFileIdentity(restoreCopy.identity),
                                bytes: copied.bytes,
                                sha256: copied.sha256,
                                openCommandId: commandId,
                                phase: 'open_pending',
                                createdAt: new Date().toISOString(),
                                documentCountBefore: capturedBaseline.documentCount,
                                baselineDocuments: capturedBaseline.documents,
                                baselineCaptureCommandId: capturedBaseline.commandId,
                            };
                            await this.backupStore.openSession(lease);
                            session = lease;
                            sessionId = backupId;
                            stage = 'open_restore_test';
                        },
                    },
                });
                opened = result.data;
            }
            catch (error) {
                if (session === null) {
                    if (error instanceof BackupSessionUnresolvedError || error instanceof ExportSessionUnresolvedError || error instanceof UnresolvedLeaseError)
                        throw error;
                    if (error instanceof BackupCopyError)
                        return failed('file_replaced', error.message);
                    if (error instanceof BackupSessionCapacityError)
                        return failed('baseline_capacity_exceeded', error.message);
                    return asIndeterminate(error);
                }
                if (error instanceof IndeterminateExecutionError)
                    return asIndeterminate(error);
                const detail = parseMcpError(error);
                if (detail?.code !== undefined && BACKUP_OPEN_PRE_ATTEMPT_CODES.includes(detail.code)) {
                    const release = await this.releaseViaInventory(session);
                    if (release !== 'released')
                        return indeterminate(`Restore-test open failed (${detail.code}) and the lease could not be released (${release}).`);
                    sessionId = null;
                    if (detail.code === 'DOCUMENT_MISMATCH' || detail.code === 'DOCUMENT_NOT_SAVED') {
                        return failed('source_changed', `The source document changed before the restore test (${detail.code}).`);
                    }
                    return failed('restore_test_open_failed', `The restore-test copy could not be opened (${detail.code}).`);
                }
                if ((detail?.code === 'BACKUP_RESTORE_TEST_PATH_MISMATCH' || detail?.code === 'BACKUP_RESTORE_TEST_NOT_ACTIVE') &&
                    detail.closed === true && typeof detail.documentCountBefore === 'number' && Number.isInteger(detail.documentCountBefore) &&
                    detail.documentCount === detail.documentCountBefore) {
                    const release = await this.releaseViaInventory(session, detail.documentCountBefore);
                    if (release !== 'released')
                        return indeterminate(`The restore-test copy was closed after an unexpected open (${detail.code}) but the lease could not be released (${release}).`);
                    sessionId = null;
                    return failed('restore_test_open_failed', `The restore-test copy opened in an unexpected state (${detail.code}) and was closed; no backup record was written.`);
                }
                return asIndeterminate(error);
            }
            if (session === null)
                return indeterminate('The open command completed without publishing its lease.');
            const lease = session;
            if (!documentKeyMatches(admittedKey, opened.source.key) || opened.restored.path === null || !sameFilePath(opened.restored.path, restoreTestPath) ||
                documentKeyMatches(admittedKey, opened.restored.key) || opened.restored.fileRevision === null ||
                opened.documentCountAfter !== opened.documentCountBefore + 1) {
                return indeterminate('Illustrator reported an unexpected document inventory after opening the restore-test copy.');
            }
            stage = 'read_restore_test';
            let restored = null;
            let restoredRecords = null;
            let readFailure = null;
            try {
                if (sourceStream !== null) {
                    restoredRecords = await this.readStructureStreamFor(opened.restored.key, spoolHolder, 'restored');
                }
                else {
                    restored = await this.readStructureDigest(opened.restored.key, { maxPageItems: BACKUP_MAX_PAGE_ITEMS });
                    if (restored.scan.comparableDigest !== source.scan.comparableDigest ||
                        restored.scan.totalPageItems !== source.scan.totalPageItems ||
                        restored.scan.artboardCount !== source.scan.artboardCount) {
                        restoredRecords = await this.readStructureSnapshotPaged(opened.restored.key, restored);
                    }
                }
            }
            catch (error) {
                if (error instanceof IndeterminateExecutionError)
                    return asIndeterminate(error);
                readFailure = error instanceof Error ? error.message : String(error);
            }
            stage = 'close_restore_test';
            let closed;
            try {
                const result = await this.executeHost({
                    kind: 'read',
                    script: BACKUP_CLOSE_RESTORE_TEST_SCRIPT,
                    params: {
                        restoreTestPath,
                        restoreTestPathForms: hostPathForms(restoreTestPath),
                        restoredDocumentKey: opened.restored.key,
                        restoredFileRevision: opened.restored.fileRevision,
                        sourcePath,
                        expectedDocumentKey: admittedKey,
                        sourceFileRevision,
                    },
                    hostGate: {
                        afterHost: async ({ data }) => {
                            const result = data;
                            if (result.documentCount !== opened.documentCountBefore) {
                                throw new Error('Illustrator reported an unexpected document inventory after closing the restore-test copy.');
                            }
                            if (!await this.releaseLeaseOnEvidence(lease, result)) {
                                throw new Error('Documents outside the backup baseline remain open. Close them and run illustrator_reconcile_backup with action inspect.');
                            }
                            sessionId = null;
                        },
                    },
                });
                closed = result.data;
            }
            catch (error) {
                return asIndeterminate(error);
            }
            stage = 'verify_source';
            if (!documentKeyMatches(admittedKey, closed.source.key) || !closed.source.saved ||
                closed.source.fileRevision !== sourceFileRevision) {
                return failed('source_changed', 'The source document no longer matches its pre-backup identity.');
            }
            let sourceAfter;
            try {
                sourceAfter = await inspectSourceFile(sourcePath);
            }
            catch (error) {
                if (error instanceof BackupPreconditionError)
                    return failed('source_changed', error.message);
                throw error;
            }
            if (sourceAfter.path !== sourceFile.path || !await sameFileOrSameBytes(sourceFile.path, sourceAfter.identity, sourceFile.identity, copied.sha256)) {
                return failed('source_changed', 'The source file changed during the backup.');
            }
            if (readFailure !== null) {
                stage = 'read_restore_test';
                return failed('restore_test_read_failed', readFailure);
            }
            let deltas = [];
            let cause = null;
            if (restoredRecords !== null) {
                stage = 'compare_structure';
                let sourceRecords;
                try {
                    sourceRecords = sourceStream ?? await this.readStructureSnapshotPaged(admittedKey, source);
                }
                catch (error) {
                    if (error instanceof IndeterminateExecutionError)
                        return asIndeterminate(error);
                    if (error instanceof DocumentMismatchError) {
                        return failed('source_changed', `The source is not the active document with its pre-backup key, so its records were not compared: ${error.message}`);
                    }
                    if (error instanceof StructureSnapshotChangedError) {
                        return failed('source_changed', 'The source structure no longer matches the page plan read before the restore test.');
                    }
                    return failed('source_changed', `The source records could not be read for the comparison: ${error instanceof Error ? error.message : String(error)}`);
                }
                deltas = compareRestoredStructure(sourceRecords, restoredRecords);
                if (deltas.length > 0)
                    cause = explainRestoredStructure(sourceRecords, restoredRecords);
            }
            if (deltas.length > 0) {
                stage = 'compare_structure';
                if (cause !== null) {
                    const detail = cause.code === EMPTY_COMPOUND_DROPPED_ON_SAVE
                        ? 'empty compound paths (inverted bounds) that Illustrator does not write to the file'
                        : 'multi-column area text frames whose columns the saved file does not hold (writing them did not mark the document changed)';
                    return failed('restore_structure_mismatch', `The restored copy differs from the source only by ${cause.items.length} item(s): ${detail}.`, deltas, cause);
                }
                return failed('restore_structure_mismatch', `The restored copy differs from the source in ${deltas.length} field(s).`, deltas);
            }
            stage = 'write_record';
            try {
                await rootScope.assertStable();
                await verifyTrackedFile(backupPath, copied.identity, copied.sha256);
            }
            catch (error) {
                if (error instanceof BackupCopyError)
                    return failed('file_replaced', error.message);
                return asIndeterminate(error);
            }
            const restoreTestRemoved = await removeRestoreTestFile(restoreTestPath, restoreCopy.identity, rootScope);
            if (restoreTestRemoved)
                files.restoreTestPath = null;
            const now = new Date().toISOString();
            const record = {
                version: 1,
                backupId,
                documentKey: input.expectedDocumentKey,
                sourcePath: sourceFile.path,
                sourceName: document.name,
                sourceFileRevision,
                backupPath,
                bytes: copied.bytes,
                sha256: copied.sha256,
                restoreVerified: {
                    method: 'open_compare',
                    restoreTestPath,
                    restoreTestRemoved,
                    restoredDocumentKey: opened.restored.key,
                    comparedItemCount: sourceItemCount,
                    comparedArtboardCount: sourceArtboardCount,
                    sourcePreserved: true,
                    verifiedAt: now,
                },
                createdAt: now,
            };
            let recordPath;
            try {
                await rootScope.assertStable();
                await verifyTrackedFile(backupPath, copied.identity, copied.sha256);
                recordPath = await this.backupStore.writeRecord(record);
            }
            catch (error) {
                if (error instanceof BackupCopyError)
                    return failed('file_replaced', error.message);
                return asIndeterminate(error);
            }
            return { outcome: 'verified', record, recordPath, retention: 'manual' };
        });
    }
    async releaseViaInventory(session, expectedDocumentCount) {
        let released = false;
        let inventory;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: BACKUP_INVENTORY_SCRIPT,
                params: { restoreTestPath: session.restoreTestPath, restoreTestPathForms: hostPathForms(session.restoreTestPath) },
                hostGate: {
                    beforeHost: async () => {
                        await this.assertSameBackupSession(session);
                    },
                    afterHost: async ({ data }) => {
                        const result = data;
                        if (result.documents.length !== 0)
                            return;
                        if (expectedDocumentCount !== undefined && result.documentCount !== expectedDocumentCount)
                            return;
                        released = await this.releaseLeaseOnEvidence(session, result);
                    },
                },
            });
            inventory = result.data;
        }
        catch (error) {
            if (error instanceof BackupSessionGoneError)
                return 'session_gone';
            throw error;
        }
        if (released)
            return 'released';
        return inventory.documents.length === 0 ? 'release_refused' : 'restore_test_open';
    }
    async reconcileBackup(input) {
        const session = await this.backupStore.readSession(input.backupId);
        if (session === null)
            return { status: 'no_session', backupId: input.backupId };
        let released = false;
        let inventory;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: BACKUP_INVENTORY_SCRIPT,
                params: { restoreTestPath: session.restoreTestPath, restoreTestPathForms: hostPathForms(session.restoreTestPath) },
                hostGate: {
                    beforeHost: async () => {
                        await this.assertSameBackupSession(session);
                    },
                    afterHost: async ({ data }) => {
                        const result = data;
                        if (result.documents.length !== 0)
                            return;
                        released = await this.releaseLeaseOnEvidence(session, result);
                    },
                },
            });
            inventory = result.data;
        }
        catch (error) {
            if (error instanceof BackupSessionGoneError)
                return { status: 'no_session', backupId: input.backupId };
            throw error;
        }
        if (released) {
            return {
                status: 'released', backupId: session.backupId, action: 'inspect', restoreTestPath: session.restoreTestPath,
                documentCount: inventory.documentCount, closedDocument: null,
                baseline: session.version === 1 ? 'absent' : 'captured', documentCountBefore: session.version === 1 ? null : session.documentCountBefore,
            };
        }
        if (input.action === 'inspect' || inventory.documents.length !== 1) {
            if (inventory.documents.length === 0)
                return this.backupReleaseRefused(session, inventory);
            return {
                status: 'restore_test_open', backupId: session.backupId, restoreTestPath: session.restoreTestPath,
                documents: inventory.documents, documentCount: inventory.documentCount,
                baseline: session.version === 1 ? 'absent' : 'captured', documentCountBefore: session.version === 1 ? null : session.documentCountBefore,
            };
        }
        const target = inventory.documents[0];
        let closed;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: BACKUP_RECONCILE_CLOSE_SCRIPT,
                params: {
                    restoreTestPath: session.restoreTestPath, restoreTestPathForms: hostPathForms(session.restoreTestPath),
                    expectedKey: target.key, expectedFileRevision: target.fileRevision,
                },
                hostGate: {
                    beforeHost: async () => {
                        await this.assertSameBackupSession(session);
                    },
                    afterHost: async ({ data }) => {
                        const result = data;
                        if (result.documents.length !== 0)
                            return;
                        released = await this.releaseLeaseOnEvidence(session, result);
                    },
                },
            });
            closed = result.data;
        }
        catch (error) {
            if (error instanceof BackupSessionGoneError)
                return { status: 'no_session', backupId: input.backupId };
            throw error;
        }
        if (!released) {
            if (closed.documents.length === 0)
                return this.backupReleaseRefused(session, closed);
            return {
                status: 'restore_test_open', backupId: session.backupId, restoreTestPath: session.restoreTestPath,
                documents: closed.documents, documentCount: closed.documentCount,
                baseline: session.version === 1 ? 'absent' : 'captured', documentCountBefore: session.version === 1 ? null : session.documentCountBefore,
            };
        }
        return {
            status: 'released', backupId: session.backupId, action: 'close_restore_test', restoreTestPath: session.restoreTestPath,
            documentCount: closed.documentCount, closedDocument: closed.closed,
            baseline: session.version === 1 ? 'absent' : 'captured', documentCountBefore: session.version === 1 ? null : session.documentCountBefore,
        };
    }
    backupReleaseRefused(session, inventory) {
        return {
            status: 'release_refused', backupId: session.backupId, restoreTestPath: session.restoreTestPath,
            documentCount: inventory.documentCount, documentCountBefore: session.version === 1 ? null : session.documentCountBefore,
            baseline: session.version === 1 ? 'absent' : 'captured',
            outsideBaselineDocuments: documentsOutsideBackupBaseline(session, inventory.allDocuments),
            message: 'Close the listed documents outside the backup baseline yourself, then run illustrator_reconcile_backup with action inspect. This tool closes only an identity-verified restore-test path match.',
            nextCall: { tool: 'illustrator_reconcile_backup', arguments: { backup_id: session.backupId, action: 'inspect' } },
        };
    }
    async reconcileDelete(input) {
        const refused = (reason, message) => reconcileDeleteResultSchema.parse({ status: 'refused', action: input.action, reason, message });
        let record;
        try {
            record = await this.backupStore.readRecord(input.backupId);
        }
        catch (error) {
            if (error instanceof BackupRecordError)
                return refused('backup_invalid', error.message);
            throw error;
        }
        if (record === null)
            return refused('backup_not_found', `No backup record exists for backup_id ${input.backupId}.`);
        if (!sameFilePath(record.sourcePath, input.expectedDocumentPath)) {
            return refused('backup_mismatch', `Backup ${input.backupId} was taken from ${record.sourcePath}, not from ${input.expectedDocumentPath}.`);
        }
        const sourcePath = record.sourcePath;
        try {
            await assertSameFilePathIdentity(input.expectedDocumentPath, sourcePath);
        }
        catch {
            return refused('backup_mismatch', 'The expected path does not identify the recorded source entry.');
        }
        if (input.action === 'inspect') {
            let fileMatchesBackup = false;
            try {
                const facts = await readFileFacts(sourcePath);
                fileMatchesBackup = facts.sha256 === record.sha256 && facts.bytes === record.bytes;
            }
            catch {
                fileMatchesBackup = false;
            }
            let documents = [];
            let data;
            try {
                data = (await this.executeHost({
                    kind: 'read',
                    script: DELETE_INSPECT_SCRIPT,
                    params: { sourcePath, expectedDocumentKey: input.expectedDocumentKey, targetUuids: input.targetUuids },
                    hostGate: {
                        beforeHost: async () => { await assertSameFilePathIdentity(input.expectedDocumentPath, sourcePath); },
                        afterHost: async ({ data }) => {
                            const inventory = data;
                            const matches = await matchingDocumentPaths({ documents: inventory.inventory, documentCount: inventory.documentCount }, [sourcePath]);
                            documents = matches.map(({ path: _path, ...summary }) => summary);
                        },
                    },
                })).data;
            }
            catch (error) {
                const locked = deleteLockRefusal(error);
                if (locked !== null)
                    return refused('command_locked', locked);
                throw error;
            }
            const only = documents.length === 1 ? documents[0] : null;
            const allPresent = data.targets !== null && data.targets.every((target) => target.present);
            if (only !== null && only.saved && data.keyMatches && allPresent && fileMatchesBackup) {
                return reconcileDeleteResultSchema.parse({
                    status: 'not_applied', action: 'inspect', backupId: input.backupId, path: sourcePath, fileMatchesBackup: true,
                    documents: documents, targets: data.targets,
                    message: 'No deletion effect is present: the document is clean, carries the apply key, every target resolves, and the file matches the backup. No revert is needed.',
                });
            }
            const reasons = [
                documents.length === 1 ? null : `${documents.length} open documents use the path`,
                only !== null && !only.saved ? 'the document has unsaved changes' : null,
                only !== null && !data.keyMatches ? 'the document key differs from the apply key' : null,
                data.targets !== null && !allPresent ? 'some targets no longer resolve' : null,
                fileMatchesBackup ? null : 'the file on disk no longer matches the backup (revert is refused)',
            ].filter((reason) => reason !== null);
            return reconcileDeleteResultSchema.parse({
                status: 'revert_required', action: 'inspect', backupId: input.backupId, path: sourcePath, fileMatchesBackup,
                documents: documents, keyMatches: data.keyMatches, targets: data.targets,
                message: `A deletion may have happened (${reasons.join('; ') || 'not provably unapplied'}). To reopen the unchanged file, call action revert with confirm_document_key set to ${only === null ? 'null' : 'documents[0].key'}; unsaved changes in that document are discarded.`,
            });
        }
        if (input.confirmDocumentKey === undefined) {
            return refused('confirmation_required', 'revert requires confirm_document_key: the full key action inspect reported for the single open document at the path, or null when none was open.');
        }
        let verified;
        try {
            verified = await verifyDeleteBackup(this.backupStore, input.backupId);
        }
        catch (error) {
            if (error instanceof DeleteBackupError)
                return refused(error.reason, error.message);
            throw error;
        }
        const verifiedDigest = canonicalSha256(verified);
        let fileUnchanged = false;
        let data;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: DELETE_REVERT_SCRIPT,
                params: {
                    sourcePath, sourceFileRevision: verified.sourceFileRevision, bytes: verified.bytes,
                    expectedDocumentKey: input.expectedDocumentKey, confirmDocumentKey: input.confirmDocumentKey, targetUuids: input.targetUuids,
                },
                timeoutMs: LIFECYCLE_HOST_TIMEOUT_MS,
                hostGate: {
                    beforeHost: async () => {
                        await this.#leaseGuard.assertNoUnresolvedSession();
                        await assertSameFilePathIdentity(input.expectedDocumentPath, sourcePath);
                        const current = await verifyDeleteBackup(this.backupStore, input.backupId);
                        if (canonicalSha256(current) !== verifiedDigest) {
                            throw new DeleteBackupError('backup_stale', 'The backup record or file changed after it was verified; revert is refused.');
                        }
                    },
                    afterHost: async () => {
                        try {
                            const facts = await readFileFacts(sourcePath);
                            fileUnchanged = facts.sha256 === verified.sha256 && facts.bytes === verified.bytes;
                        }
                        catch {
                            fileUnchanged = false;
                        }
                    },
                },
            });
            data = result.data;
        }
        catch (error) {
            const locked = deleteLockRefusal(error);
            if (locked !== null)
                return refused('command_locked', locked);
            if (error instanceof IndeterminateExecutionError) {
                return reconcileDeleteResultSchema.parse({
                    status: 'indeterminate', action: 'revert', commandId: error.commandId ?? null,
                    message: `${error.message} The document may be closed and not reopened. Resolve the command with illustrator_reconcile, then run action inspect again.`,
                });
            }
            if (error instanceof DeleteBackupError)
                return refused(error.reason, error.message);
            const detail = parseMcpError(error);
            if (detail?.code === 'DELETE_REVERT_FILE_CHANGED')
                return refused('file_changed', detail.message ?? 'The file changed; revert is refused.');
            if (detail?.code === 'DELETE_REVERT_AMBIGUOUS')
                return refused('ambiguous_documents', detail.message ?? 'More than one open document uses the path.');
            if (detail?.code === 'DELETE_REVERT_CONFIRMATION_MISMATCH') {
                return refused('confirmation_mismatch', `confirm_document_key ${detail.expected ?? ''} does not match the open document (${detail.actual ?? ''}); run action inspect again. Nothing was closed.`);
            }
            throw error;
        }
        const notRestored = (stage, message) => reconcileDeleteResultSchema.parse({
            status: 'not_restored', action: 'revert', backupId: input.backupId, path: sourcePath, stage, documents: data.documents,
            message: `${message} Run action inspect before anything else.`,
        });
        if (data.outcome !== 'reopened')
            return notRestored(data.outcome === 'close_failed' ? 'close' : 'open', data.message);
        const failed = Object.entries(data.checks).filter(([, ok]) => !ok).map(([name]) => name);
        if (failed.length > 0)
            return notRestored('verify', `The reopened document did not match the pre-delete document (${failed.join(', ')}).`);
        if (!fileUnchanged)
            return notRestored('file', 'The file no longer hashes to the backup after the reopen.');
        return reconcileDeleteResultSchema.parse({
            status: 'restored', action: 'revert', backupId: input.backupId, path: sourcePath, closedDocument: data.closed,
            document: data.document, targets: data.targets, targetUuidsResolve: data.targets.every((target) => target.present),
            fileUnchanged: true, durationMs: data.durationMs,
            message: 'Reopened the unchanged file: path, revision, saved, saved_file, key (collection index aside), other documents, and the file hash match the pre-delete state. Target UUID resolution is informational only. Read the document key again before the next mutation.',
        });
    }
    async releaseExportLeaseOnEvidence(session, remainingDocuments) {
        if (remainingDocuments !== 0)
            throw new Error(`The export work copy is still open (${remainingDocuments} document(s)).`);
        if (!(await this.commandInactive(session.openCommandId))) {
            throw new Error(`The host open command ${session.openCommandId} is not proven inactive; the export session stays unresolved.`);
        }
        await this.exportStore.releaseSession(session.exportId);
    }
    async exportOutlined(input) {
        let outlineSummary = null;
        const rejected = (reason, message, document = null, availablePresets = null) => ({ outcome: 'rejected', reason, message, document, availablePresets });
        const read = await this.readExportSource(input.expectedDocumentKey, true);
        if (read.kind === 'indeterminate')
            return { outcome: 'indeterminate', stage: 'read_source', message: read.message, commandId: read.commandId, files: { workCopyPath: null, stagedPath: null, outputPath: null }, sessionId: null };
        if (read.kind === 'rejected')
            return rejected(read.reason, read.message, read.document);
        const { source, document } = read;
        if (source.artboards.length === 0)
            return rejected('document_not_admitted', 'The document has no artboards.', document);
        let pdfPreset = null;
        if (input.format === 'pdf') {
            if (input.pdfPreset === undefined || !source.pdfPresets.includes(input.pdfPreset)) {
                return rejected('pdf_preset_unknown', input.pdfPreset === undefined
                    ? 'pdf_preset is required for format "pdf"; choose one of availablePresets.'
                    : `pdf_preset ${JSON.stringify(input.pdfPreset)} is not in Illustrator's PDF preset list; choose one of availablePresets.`, document, source.pdfPresets);
            }
            pdfPreset = input.pdfPreset;
        }
        else if (input.pdfPreset !== undefined) {
            return rejected('pdf_preset_unknown', 'pdf_preset applies to format "pdf" only; omit it for format "ai".', document, source.pdfPresets);
        }
        let outlined = null;
        const run = await this.runWorkCopyExport({
            expectedDocumentKey: input.expectedDocumentKey,
            format: input.format,
            outputPath: input.outputPath,
            source,
            document,
            prepare: async ({ workCopyPath, opened }) => {
                let data;
                try {
                    const result = await this.executeHost({
                        kind: 'read',
                        script: EXPORT_OUTLINE_SCRIPT,
                        params: { workCopyPath, workCopyKey: opened.opened.key },
                        timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    });
                    data = result.data;
                }
                catch (error) {
                    return { indeterminate: error };
                }
                outlined = data;
                outlineSummary = { textFramesBefore: data.textFramesBefore, textFramesAfter: data.textFramesAfter, errors: data.errors };
                let failure = null;
                if (data.errors.length > 0) {
                    failure = `${data.errors.length} text frame(s) could not be outlined (first: ${data.errors[0].message}).`;
                }
                else if (data.restoreErrors.length > 0) {
                    const first = data.restoreErrors[0];
                    failure = `${data.restoreErrors.length} layer restoration(s) failed (first: ${first.layer} ${first.attribute}: ${first.message}).`;
                }
                else if (data.textFramesAfter !== 0) {
                    failure = `${data.textFramesAfter} text frame(s) remain after outlining.`;
                }
                else if (deepDifferences(source.artboards, data.artboards, '$.artboards').length > 0) {
                    failure = 'The artboards changed during outlining.';
                }
                else if (deepDifferences(source.layers, data.layers, '$.layers').length > 0) {
                    failure = 'The layer lock or visibility state was not restored after outlining.';
                }
                return { failure, workCopyKey: data.workCopy.key };
            },
            saveScript: EXPORT_SAVE_OUTPUT_SCRIPT,
            savePreAttemptCodes: EXPORT_SAVE_PRE_ATTEMPT_CODES,
            saveParams: ({ workCopyPath, workCopyKey, stagedPath, outputPath }) => ({ workCopyPath, workCopyKey, stagedPath, outputPath, format: input.format, pdfPreset }),
            verify: async (stagedPath, stagingDirectory) => await verifyOutputFile(stagedPath, source.artboards.length, () => syncDirectory(stagingDirectory)),
            finish: async ({ exportId, sourcePath, sourceFileRevision, verification, published, workCopyPath, workCopyRemoved, stagingDirectory, outputPath }) => {
                const outline = outlined;
                const record = {
                    version: 1,
                    exportId,
                    documentKey: input.expectedDocumentKey,
                    sourcePath,
                    sourceName: document.name,
                    sourceFileRevision,
                    format: input.format,
                    outputPath,
                    bytes: verification.bytes,
                    sha256: verification.sha256,
                    outputIdentity: serializeFileIdentity(published.identity),
                    pdfPreset,
                    outline: {
                        textFramesBefore: outline.textFramesBefore,
                        textFramesAfter: outline.textFramesAfter,
                        groupItemsAdded: outline.counts.groupItems - source.counts.groupItems,
                        pageItemsBefore: source.counts.pageItems,
                        pageItemsAfter: outline.counts.pageItems,
                    },
                    verification: {
                        method: 'pdf_header_scan',
                        header: verification.header,
                        pageObjects: verification.pageObjects,
                        artboardCount: source.artboards.length,
                        fontObjects: verification.fontObjects,
                    },
                    workCopy: { path: workCopyPath, removed: workCopyRemoved },
                    staging: { directory: stagingDirectory, removed: published.stagingRemoved },
                    sourcePreserved: true,
                    createdAt: new Date().toISOString(),
                };
                const recordPath = await this.exportStore.writeRecord(record);
                return { record, recordPath };
            },
        });
        const { outcome, files, sessionId } = run;
        switch (outcome.kind) {
            case 'published': return { outcome: 'verified', record: outcome.value.record, recordPath: outcome.value.recordPath, retention: 'manual' };
            case 'rejected': return rejected(outcome.reason, outcome.message, document);
            case 'failed': return { outcome: 'failed', reason: outcome.reason, stage: outcome.stage, message: outcome.message, files, outline: outlineSummary };
            case 'indeterminate': return { outcome: 'indeterminate', stage: outcome.stage, message: outcome.message, commandId: outcome.commandId, files, sessionId };
        }
    }
    async exportPdf(input) {
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);
        const rejected = (reason, message, document = null, availablePresets = null) => ({ outcome: 'rejected', reason, message, document, availablePresets });
        const bleedInput = normalizePdfBleed(input.bleed);
        if ('reason' in bleedInput)
            return rejected(bleedInput.reason, bleedInput.message);
        const scanLimit = !input.apply && marksNeedRegistrationScan(input.marks) ? EXPORT_REGISTRATION_SCAN_LIMITS.pathItems : undefined;
        const fontScanLimit = input.pdfx === undefined ? undefined : PDFX_FONT_SCAN_FRAME_LIMIT;
        const read = await this.readExportSource(input.expectedDocumentKey, input.apply, scanLimit, fontScanLimit);
        if (read.kind === 'indeterminate') {
            return { outcome: 'indeterminate', stage: 'read_source', message: read.message, commandId: read.commandId, files: { workCopyPath: null, stagedPath: null, outputPath: null }, sessionId: null };
        }
        if (read.kind === 'rejected')
            return rejected(read.reason, read.message, read.document);
        const { source, document } = read;
        if (source.artboards.length === 0)
            return rejected('document_not_admitted', 'The document has no artboards.', document);
        if (scanLimit !== undefined && (source.registrationScan === null || source.registrationScan === undefined)) {
            throw new Error('The export source read did not return the requested Registration-line scan.');
        }
        const plan = planPdfExport(input, document, source.artboards, source.pdfPresets);
        if ('reason' in plan)
            return rejected(plan.reason, plan.message, document, plan.reason === 'pdf_preset_unknown' ? source.pdfPresets : null);
        const preset = presetReport(plan.preset);
        if (plan.pdfx !== null) {
            if (source.fontScan === null || source.fontScan === undefined)
                throw new Error('The export source read did not return the requested font scan.');
            const names = source.fontScan.fontNames;
            const verification = names.length === 0 ? {} : await this.fontVerifier.verify(names, this.bridge.applicationTarget?.()?.bundleId ?? null);
            const refusal = pdfxFontRefusal(source.fontScan, verification);
            if (refusal !== null)
                return rejected('pdfx_fonts_unverified', refusal, document);
        }
        if (!input.apply) {
            try {
                const sourceRealPath = await realpath(document.path);
                await validateOutputPath(input.outputPath, 'pdf', sourceRealPath, this.exportStore.stateRootPath);
            }
            catch (error) {
                if (error instanceof ExportPreconditionError)
                    return rejected(error.reason, error.message, document);
                return rejected('source_file_unavailable', `The source file could not be resolved: ${error instanceof Error ? error.message : String(error)}`, document);
            }
            return {
                outcome: 'planned',
                document,
                plan: { preset, artboardRange: plan.artboardRange, pages: plan.pages, marks: plan.marks, bleed: plan.bleed, bleedSource: plan.bleedSource, expectedBleedMm: plan.expectedBleedMm, pdfx: plan.pdfx, outputPath: plan.outputPath, planDigest: plan.planDigest },
                nextCall: {
                    expected_document_key: input.expectedDocumentKey,
                    output_path: plan.outputPath,
                    pdf_preset: plan.preset,
                    artboards: plan.artboardRange,
                    marks: { trim: plan.marks.trim, registration: plan.marks.registration, color_bars: plan.marks.colorBars, page_information: plan.marks.pageInformation, style: plan.marks.style },
                    bleed: plan.bleedSource === 'document_via_preset' ? { mode: 'document', expected_mm: 3 } : { ...plan.bleed },
                    ...(plan.pdfx === null ? {} : { pdfx: {
                            standard: plan.pdfx.standard,
                            ...(plan.pdfx.outputCondition === null ? {} : { output_condition: {
                                    identifier: plan.pdfx.outputCondition.identifier,
                                    ...(plan.pdfx.outputCondition.condition === null ? {} : { condition: plan.pdfx.outputCondition.condition }),
                                    ...(plan.pdfx.outputCondition.registry === null ? {} : { registry: plan.pdfx.outputCondition.registry }),
                                } }),
                        } }),
                    ...(plan.preserveEditability === null ? {} : { preserve_editability: plan.preserveEditability }),
                    apply: true,
                    expected_plan_digest: plan.planDigest,
                },
                warnings: registrationScanWarnings(source.registrationScan),
                registrationScan: source.registrationScan ?? null,
                hostCalls: 1,
                durationMs: elapsed(),
            };
        }
        if (input.expectedPlanDigest !== plan.planDigest) {
            return rejected('plan_stale', input.expectedPlanDigest === undefined
                ? 'apply requires expected_plan_digest from the plan (apply=false); call the plan first and apply with its nextCall.'
                : 'The document, its file revision, its artboards or the requested options no longer match the plan; plan again.', document);
        }
        let structure = null;
        const run = await this.runWorkCopyExport({
            expectedDocumentKey: input.expectedDocumentKey,
            format: 'pdf',
            outputPath: input.outputPath,
            source,
            document,
            saveScript: input.preserveEditability === undefined ? PDF_EXPORT_SAVE_SCRIPT : PDF_EXPORT_SAVE_PRESERVE_SCRIPT,
            savePreAttemptCodes: PDF_EXPORT_SAVE_PRE_ATTEMPT_CODES,
            saveParams: ({ workCopyPath, workCopyKey, stagedPath, outputPath }) => ({ workCopyPath, workCopyKey, stagedPath, outputPath, ...pdfSaveParams(plan, source.artboards) }),
            verify: async (stagedPath, stagingDirectory) => {
                const verification = await verifyOutputFile(stagedPath, null, () => syncDirectory(stagingDirectory));
                structure = await verifyPdfStructure(stagedPath, plan);
                return verification;
            },
            finish: async (context) => context,
        });
        const { outcome, files, sessionId } = run;
        const hostCalls = run.hostCalls + 1;
        switch (outcome.kind) {
            case 'rejected': return rejected(outcome.reason, outcome.message, document);
            case 'failed':
                if (outcome.reason === 'outline_incomplete')
                    throw new Error('PDF export has no outline stage.');
                return { outcome: 'failed', reason: outcome.reason, stage: outcome.stage, message: outcome.message, files };
            case 'indeterminate': return { outcome: 'indeterminate', stage: outcome.stage, message: outcome.message, commandId: outcome.commandId, files, sessionId };
            case 'published': {
                const verified = structure;
                if (verified === null)
                    throw new Error('The PDF structure was not recorded before publication.');
                const { verification, published, workCopyPath, workCopyRemoved, stagingDirectory, outputPath, save } = outcome.value;
                return {
                    outcome: 'verified',
                    outputPath,
                    bytes: verification.bytes,
                    sha256: verification.sha256,
                    preset,
                    artboardRange: plan.artboardRange,
                    marks: plan.marks,
                    bleed: plan.bleed,
                    bleedSource: plan.bleedSource,
                    expectedBleedMm: plan.expectedBleedMm,
                    pages: plan.pages.map((page, index) => ({
                        ...page, mediaBox: verified.pages[index].mediaBox, trimBox: verified.pages[index].trimBox, bleedBox: verified.pages[index].bleedBox,
                    })),
                    pdf: pdfFacts(verified),
                    pdfx: pdfxReport(verified, plan.pdfx),
                    ...preserveEditabilityOptions(plan.preserveEditability, save),
                    workCopy: { path: workCopyPath, removed: workCopyRemoved },
                    staging: { directory: stagingDirectory, removed: published.stagingRemoved },
                    sourcePreserved: true,
                    hostCalls,
                    durationMs: elapsed(),
                };
            }
        }
    }
    async readExportSource(expectedDocumentKey, leaseCheck, registrationScanLimit, fontScanLimit) {
        let source;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: fontScanLimit === undefined ? EXPORT_READ_SOURCE_SCRIPT : EXPORT_READ_SOURCE_FONTS_SCRIPT,
                params: { expectedDocumentKey, ...(registrationScanLimit === undefined ? {} : { registrationScanLimit }), ...(fontScanLimit === undefined ? {} : { fontScanLimit }) },
                ...(leaseCheck ? { hostGate: { beforeHost: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); } } } : {}),
            });
            source = result.data;
        }
        catch (error) {
            if (error instanceof BackupSessionUnresolvedError || error instanceof ExportSessionUnresolvedError || error instanceof UnresolvedLeaseError)
                throw error;
            if (error instanceof IndeterminateExecutionError)
                return { kind: 'indeterminate', message: error.message, commandId: error.commandId };
            const detail = parseExportHostError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                return { kind: 'rejected', reason: 'document_key_mismatch', message: `The active document key does not match expected_document_key (${detail.actual === undefined ? 'unknown' : String(detail.actual)}).`, document: null };
            }
            throw error;
        }
        if (!documentKeyMatches(expectedDocumentKey, source.document.key)) {
            return { kind: 'rejected', reason: 'document_key_mismatch', message: 'Illustrator reported a different document key than expected.', document: null };
        }
        const document = source.document;
        if (document.mutationProfile !== 'saved_file' || document.path === null || document.fileRevision === null) {
            return { kind: 'rejected', reason: 'document_not_admitted', message: document.mutationBlockedReason ?? EXPORT_REQUIRES_SAVED_FILE_MESSAGE, document };
        }
        return { kind: 'read', source, document };
    }
    async runWorkCopyExport(spec) {
        const files = { workCopyPath: null, stagedPath: null, outputPath: null };
        let stage = 'read_source';
        let sessionId = null;
        let hostCalls = 0;
        const done = (outcome) => ({ outcome, files, sessionId, hostCalls });
        const indeterminate = (message, commandId = null) => done({ kind: 'indeterminate', stage, message, commandId });
        const failed = (reason, message) => done({ kind: 'failed', reason, stage, message });
        const rejected = (reason, message) => done({ kind: 'rejected', reason, message });
        const asIndeterminate = (error) => {
            if (error instanceof IndeterminateExecutionError)
                return indeterminate(error.message, error.commandId);
            return indeterminate(error instanceof Error ? error.message : String(error));
        };
        const isLeaseError = (error) => error instanceof BackupSessionUnresolvedError || error instanceof ExportSessionUnresolvedError || error instanceof UnresolvedLeaseError;
        const { source, document } = spec;
        const admittedKey = document.key;
        const sourcePath = document.path;
        const sourceFileRevision = document.fileRevision;
        let sourceFile;
        let exportRoot;
        let output;
        try {
            sourceFile = await inspectSourceFile(sourcePath);
            await this.exportStore.ensure();
            exportRoot = await resolveBackupRoot(this.exportStore.recordDirectory);
            output = await validateOutputPath(spec.outputPath, spec.format, sourceFile.path, this.exportStore.stateRootPath);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError) {
                return rejected(error.reason === 'backup_root_unavailable' ? 'export_root_unavailable' : 'source_file_unavailable', error.message);
            }
            if (error instanceof ExportPreconditionError)
                return rejected(error.reason, error.message);
            throw error;
        }
        return await withBackupRootScope(exportRoot, async (rootScope) => await withOutputParentScope(output.parent, async (parentScope) => {
            const exportId = newExportId();
            const workCopyPath = join(exportRoot, workCopyFileName(exportId, sourceFile.path));
            stage = 'copy_work';
            let copied;
            try {
                copied = await copyFileExclusive(sourceFile.path, workCopyPath, sourceFile.identity);
                files.workCopyPath = workCopyPath;
            }
            catch (error) {
                if (copyErrorCreatedDestination(error))
                    files.workCopyPath = workCopyPath;
                if (error instanceof BackupCopyError)
                    return failed('copy_mismatch', error.message);
                return asIndeterminate(error);
            }
            let staging;
            try {
                await parentScope.assertStable();
                staging = await createStagingDirectory(output.parent, exportId, output.path);
            }
            catch (error) {
                if (error instanceof ExportPreconditionError)
                    return rejected(error.reason, error.message);
                return asIndeterminate(error);
            }
            const stagedPath = staging.stagedPath;
            const sessionPaths = [workCopyPath, stagedPath, output.path];
            stage = 'open_session';
            let session = null;
            let opened;
            try {
                hostCalls += 1;
                const result = await this.executeHost({
                    kind: 'read',
                    script: EXPORT_OPEN_WORK_COPY_SCRIPT,
                    params: { expectedDocumentKey: admittedKey, workCopyPath, stagedPath, outputPath: output.path, sessionPaths },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.#leaseGuard.assertNoUnresolvedSession();
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            await verifyTrackedFile(workCopyPath, copied.identity, copied.sha256);
                            await assertOutputAbsent(output.path);
                            await assertOutputAbsent(stagedPath);
                            const lease = {
                                version: 1,
                                exportId,
                                documentKey: spec.expectedDocumentKey,
                                sourcePath: sourceFile.path,
                                format: spec.format,
                                workCopyPath,
                                workCopyIdentity: serializeFileIdentity(copied.identity),
                                stagingDirectory: staging.directory,
                                stagedPath,
                                outputPath: output.path,
                                bytes: copied.bytes,
                                sha256: copied.sha256,
                                openCommandId: commandId,
                                phase: 'open_pending',
                                createdAt: new Date().toISOString(),
                            };
                            await this.exportStore.openSession(lease);
                            session = lease;
                            sessionId = exportId;
                            stage = 'open_work_copy';
                        },
                        afterHost: async ({ commandId, data }) => {
                            const result = data;
                            const hostRecord = {
                                version: 1,
                                exportId,
                                openCommandId: commandId,
                                workCopy: hostRecordIdentityOf(result.opened),
                                artboardRects: artboardRectsOf(source.artboards),
                                recordedAt: new Date().toISOString(),
                            };
                            await this.exportStore.writeHostRecord(hostRecord);
                        },
                    },
                });
                opened = result.data;
            }
            catch (error) {
                if (session === null) {
                    if (isLeaseError(error))
                        throw error;
                    if (error instanceof BackupCopyError)
                        return failed('file_replaced', error.message);
                    if (error instanceof ExportPreconditionError)
                        return rejected(error.reason, error.message);
                    return asIndeterminate(error);
                }
                if (error instanceof IndeterminateExecutionError)
                    return asIndeterminate(error);
                const detail = parseExportHostError(error);
                if (detail?.code !== undefined && EXPORT_OPEN_PRE_ATTEMPT_CODES.includes(detail.code)) {
                    const release = await this.releaseExportViaInventory(session);
                    if (release !== 'released')
                        return indeterminate(`Work-copy open failed (${detail.code}) and the lease could not be released (${release}).`);
                    sessionId = null;
                    if (detail.code === 'DOCUMENT_MISMATCH' || detail.code === 'DOCUMENT_NOT_SAVED') {
                        return failed('source_changed', `The source document changed before the work copy was opened (${detail.code}).`);
                    }
                    return failed('work_copy_open_failed', `The work copy could not be opened (${detail.code}).`);
                }
                return asIndeterminate(error);
            }
            if (session === null)
                return indeterminate('The open command completed without publishing its lease.');
            const lease = session;
            if (opened.source.key !== admittedKey || (opened.opened.path === null || !sameFilePath(opened.opened.path, workCopyPath)) ||
                opened.opened.key === admittedKey || opened.documentCountAfter !== opened.documentCountBefore + 1) {
                return indeterminate('Illustrator reported an unexpected document inventory after opening the work copy.');
            }
            let prepareFailure = null;
            let workCopyKey = opened.opened.key;
            if (spec.prepare !== undefined) {
                stage = 'outline';
                hostCalls += 1;
                const prepared = await spec.prepare({ workCopyPath, opened });
                if ('indeterminate' in prepared)
                    return asIndeterminate(prepared.indeterminate);
                prepareFailure = prepared.failure;
                workCopyKey = prepared.workCopyKey;
            }
            let closeTarget = { path: workCopyPath, key: workCopyKey };
            let saved = null;
            let saveFailure = null;
            if (prepareFailure === null) {
                stage = 'save_output';
                try {
                    hostCalls += 1;
                    const result = await this.executeHost({
                        kind: 'read',
                        script: spec.saveScript,
                        params: spec.saveParams({ workCopyPath, workCopyKey, stagedPath, outputPath: output.path }),
                        timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                        hostGate: {
                            beforeHost: async () => {
                                await rootScope.assertStable();
                                await parentScope.assertStable();
                                await assertOutputAbsent(output.path);
                                await assertOutputAbsent(stagedPath);
                            },
                        },
                    });
                    saved = result.data;
                }
                catch (error) {
                    if (error instanceof IndeterminateExecutionError)
                        return asIndeterminate(error);
                    if (error instanceof ExportPreconditionError) {
                        saveFailure = `${error.message} (nothing was sent to Illustrator).`;
                    }
                    else {
                        const detail = parseExportHostError(error);
                        if (detail?.code === 'EXPORT_WORK_COPY_NOT_UNIQUE' || detail?.code === 'EXPORT_WORK_COPY_IDENTITY_MISMATCH') {
                            return asIndeterminate(error);
                        }
                        if (detail?.code !== undefined && spec.savePreAttemptCodes.includes(detail.code)) {
                            saveFailure = `The save was refused before any write (${detail.code}).`;
                        }
                        else if (detail?.code === EXPORT_SAVE_FAILED_CODE) {
                            if (detail.outputExists === true)
                                return indeterminate(`Illustrator reported a save error but the output file exists: ${detail.message ?? ''}`);
                            saveFailure = `Illustrator refused the save: ${detail.message ?? 'unknown error'}`;
                        }
                        else {
                            return asIndeterminate(error);
                        }
                    }
                }
                if (saved !== null) {
                    files.stagedPath = stagedPath;
                    if (!sameFilePath(saved.pathAfter, stagedPath) && !sameFilePath(saved.pathAfter, workCopyPath)) {
                        return indeterminate(`Illustrator reported an unexpected document path after saving (${saved.pathAfter}).`);
                    }
                    closeTarget = { path: saved.pathAfter, key: saved.workCopy.key };
                }
            }
            let verification = null;
            let verifyFailure = null;
            if (saved !== null) {
                stage = 'verify_output';
                try {
                    verification = await spec.verify(stagedPath, staging.directory);
                }
                catch (error) {
                    if (error instanceof OutputVerificationError)
                        verifyFailure = error.message;
                    else
                        return asIndeterminate(error);
                }
            }
            stage = 'close_work_copy';
            let closed;
            try {
                hostCalls += 1;
                const result = await this.executeHost({
                    kind: 'read',
                    script: EXPORT_CLOSE_WORK_COPY_SCRIPT,
                    params: {
                        workCopyPath: closeTarget.path,
                        workCopyKey: closeTarget.key,
                        sessionPaths,
                        sourcePath,
                        expectedDocumentKey: admittedKey,
                        sourceFileRevision,
                    },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        afterHost: async ({ data }) => {
                            const result = data;
                            if (result.documentCount !== opened.documentCountBefore) {
                                throw new Error('Illustrator reported an unexpected document inventory after closing the work copy.');
                            }
                            if ((await matchingDocumentPaths(result, sessionPaths)).length !== 0)
                                throw new Error('A session document remains open; the export lease is kept.');
                            await this.releaseExportLeaseOnEvidence(lease, 0);
                            sessionId = null;
                        },
                    },
                });
                closed = result.data;
            }
            catch (error) {
                return asIndeterminate(error);
            }
            stage = 'verify_source';
            if (closed.source.key !== admittedKey || !closed.source.saved || closed.source.fileRevision !== sourceFileRevision) {
                return failed('source_changed', 'The source document no longer matches its pre-export identity.');
            }
            let sourceAfter;
            try {
                sourceAfter = await inspectSourceFile(sourcePath);
            }
            catch (error) {
                if (error instanceof BackupPreconditionError)
                    return failed('source_changed', error.message);
                throw error;
            }
            if (sourceAfter.path !== sourceFile.path || !await sameFileOrSameBytes(sourceFile.path, sourceAfter.identity, sourceFile.identity, copied.sha256)) {
                return failed('source_changed', 'The source file changed during the export.');
            }
            if (prepareFailure !== null) {
                stage = 'outline';
                return failed('outline_incomplete', prepareFailure);
            }
            if (saveFailure !== null) {
                stage = 'save_output';
                return failed('save_failed', saveFailure);
            }
            if (verifyFailure !== null || verification === null) {
                stage = 'verify_output';
                return failed('output_verification_failed', verifyFailure ?? 'The output file was not verified.');
            }
            stage = 'publish_output';
            let published;
            try {
                await rootScope.assertStable();
                await parentScope.assertStable();
                await verifyOutputUnchanged(stagedPath, verification);
                published = await publishOutput(stagedPath, output.path, verification, parentScope);
                files.outputPath = output.path;
                if (published.stagingRemoved)
                    files.stagedPath = null;
            }
            catch (error) {
                if (error instanceof OutputPublishError)
                    return failed(error.reason, error.message);
                if (error instanceof BackupCopyError)
                    return failed('file_replaced', error.message);
                return asIndeterminate(error);
            }
            const publishedVerification = { ...verification, identity: published.identity };
            stage = 'write_record';
            try {
                await rootScope.assertStable();
                await parentScope.assertStable();
                await verifyOutputUnchanged(output.path, publishedVerification);
            }
            catch (error) {
                if (error instanceof BackupCopyError)
                    return failed('file_replaced', error.message);
                return asIndeterminate(error);
            }
            const workCopyRemoved = await removeRestoreTestFile(workCopyPath, copied.identity, rootScope);
            if (workCopyRemoved)
                files.workCopyPath = null;
            try {
                await rootScope.assertStable();
                await parentScope.assertStable();
                await verifyOutputUnchanged(output.path, publishedVerification);
                const value = await spec.finish({
                    exportId, sourcePath: sourceFile.path, sourceFileRevision, verification, published,
                    workCopyPath, workCopyRemoved, stagingDirectory: staging.directory, outputPath: output.path, save: saved,
                });
                return done({ kind: 'published', value });
            }
            catch (error) {
                if (error instanceof BackupCopyError)
                    return failed('file_replaced', error.message);
                return asIndeterminate(error);
            }
        }));
    }
    async optimizeImages(input) {
        const startedAt = performance.now();
        const hostMs = {};
        const files = { workCopyPath: null, stagedPath: null, outputPath: null, renderFiles: [] };
        let stage = 'read_source';
        let sessionId = null;
        let chosenSave = null;
        let evidenceDirectory;
        const indeterminate = (message, commandId = null) => ({ outcome: 'indeterminate', stage, message, commandId, files, sessionId, save: chosenSave });
        const failed = (reason, message, details = []) => ({ outcome: 'failed', reason, stage, message, details, files, save: chosenSave,
            ...(evidenceDirectory === undefined ? {} : { evidenceDirectory }) });
        const rejected = (reason, message, document = null, details = []) => ({ outcome: 'rejected', reason, message, document, details });
        const asIndeterminate = (error) => {
            if (error instanceof IndeterminateExecutionError)
                return indeterminate(error.message, error.commandId);
            return indeterminate(error instanceof Error ? error.message : String(error));
        };
        const isLeaseError = (error) => error instanceof BackupSessionUnresolvedError || error instanceof ExportSessionUnresolvedError || error instanceof UnresolvedLeaseError;
        const timed = async (label, run) => {
            const started = performance.now();
            try {
                return await run();
            }
            finally {
                hostMs[label] = Math.round(performance.now() - started);
            }
        };
        const channel = this.bridge.applicationTarget?.()?.channel ?? 'unknown';
        let source;
        try {
            const result = await timed('read', async () => await this.executeHost({
                kind: 'read',
                script: IMAGE_OPTIMIZE_READ_SOURCE_SCRIPT,
                params: { expectedDocumentKey: input.expectedDocumentKey, maxScannedImages: IMAGE_OPTIMIZE_MAX_SCANNED_IMAGES },
                ...(input.apply ? { hostGate: { beforeHost: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); } } } : {}),
            }));
            source = result.data;
        }
        catch (error) {
            if (isLeaseError(error))
                throw error;
            if (error instanceof IndeterminateExecutionError)
                return asIndeterminate(error);
            const detail = parseExportHostError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH') {
                return rejected('document_key_mismatch', `The active document key does not match expected_document_key (${detail.actual === undefined ? 'unknown' : String(detail.actual)}).`);
            }
            if (detail?.code === 'OPTIMIZE_TOO_MANY_IMAGES') {
                return rejected('too_many_images', `The document holds more than ${IMAGE_OPTIMIZE_MAX_SCANNED_IMAGES} raster items; it is not scanned.`);
            }
            throw error;
        }
        if (!documentKeyMatches(input.expectedDocumentKey, source.document.key)) {
            return rejected('document_key_mismatch', 'Illustrator reported a different document key than expected.');
        }
        const document = source.document;
        const admittedKey = document.key;
        if (document.mutationProfile !== 'saved_file' || document.path === null || document.fileRevision === null) {
            return rejected('document_not_admitted', document.mutationBlockedReason ?? EXPORT_REQUIRES_SAVED_FILE_MESSAGE, document);
        }
        const hostVersion = evaluateHostVersion('optimize_images', document.appVersion);
        if (!hostVersionAdmitted('optimize_images', document.appVersion) || (hostVersion.status !== 'measured' && channel !== 'stable')) {
            return rejected('host_version_unmeasured', `Image optimization is not admitted on ${document.appVersion} (${hostVersion.status}, ${channel}). `
                + 'Blocked and unreadable versions, and versions that are not measured on a non-stable channel, cannot be used.', document);
        }
        if (document.colorSpace !== 'RGB') {
            return rejected('document_color_space_unsupported', 'Only RGB documents are measured: DEFAULTCOLORMODEL rasterizes to the document colour model.', document);
        }
        if (source.artboards.length !== 1) {
            return rejected('multiple_artboards_unmeasured', `The render check is measured on a single artboard; the document has ${source.artboards.length}.`, document);
        }
        const artboard = source.artboards[0].rect;
        const render = renderGeometry(artboard, input.capPpi);
        if (render.width * render.height > IMAGE_OPTIMIZE_RENDER_MAX_PIXELS || render.width < 1 || render.height < 1) {
            return rejected('render_budget_exceeded', `The artboard at ${input.capPpi} ppi is ${render.width}x${render.height} px; the render check allows at most ${IMAGE_OPTIMIZE_RENDER_MAX_PIXELS} px.`, document);
        }
        const { candidates, excluded } = classifyRasters(source.rasters, input.capPpi, artboard);
        let sourceScan;
        try {
            sourceScan = await scanPdfObjects(document.path);
        }
        catch (error) {
            return rejected('source_file_unavailable', `The source file could not be read: ${error instanceof Error ? error.message : String(error)}`, document);
        }
        if (!sourceScan.header.startsWith('%PDF-')) {
            return rejected('source_file_unsupported', 'The source file is not a PDF-based AI file.', document);
        }
        const saveOptions = imageOptimizeSaveOptions(sourceScan.imageObjects > 0);
        chosenSave = saveOptions;
        const iccProfile = { embedded: false, carriedOver: false, note: IMAGE_OPTIMIZE_ICC_NOTE };
        let targets = candidates;
        if (input.targetUuids !== undefined) {
            if (new Set(input.targetUuids).size !== input.targetUuids.length) {
                return rejected('target_not_eligible', 'target_uuids must not repeat an id.', document);
            }
            const byUuid = new Map(candidates.map((candidate) => [candidate.uuid, candidate]));
            const missing = input.targetUuids.filter((uuid) => !byUuid.has(uuid));
            if (missing.length > 0) {
                const reasons = missing.map((uuid) => {
                    const exclusion = excluded.find((entry) => entry.uuid === uuid);
                    return `${uuid}: ${exclusion === undefined ? 'not a raster item of this document' : exclusion.reason}`;
                });
                return rejected('target_not_eligible', 'Every target_uuids entry must be an eligible candidate of the plan.', document, reasons);
            }
            targets = input.targetUuids.map((uuid) => byUuid.get(uuid));
        }
        if (!input.apply) {
            return {
                outcome: 'planned', document,
                plan: {
                    capPpi: input.capPpi, targets, excluded, save: saveOptions, iccProfile, render,
                    limits: { maxTargets: IMAGE_OPTIMIZE_MAX_TARGETS, maxScannedImages: IMAGE_OPTIMIZE_MAX_SCANNED_IMAGES, renderMaxPixels: IMAGE_OPTIMIZE_RENDER_MAX_PIXELS },
                },
            };
        }
        if (input.targetUuids === undefined)
            return rejected('targets_required', 'apply=true needs target_uuids from the plan.', document);
        if (targets.length === 0)
            return rejected('no_targets', 'No target to optimize.', document);
        if (targets.length > IMAGE_OPTIMIZE_MAX_TARGETS) {
            return rejected('too_many_targets', `At most ${IMAGE_OPTIMIZE_MAX_TARGETS} images per call; ${targets.length} were requested.`, document);
        }
        if (input.outputPath === undefined)
            return rejected('output_path_required', 'apply=true needs output_path.', document);
        const observed = await this.hostProfileProbe.observe();
        if (observed.profile !== 'foreground') {
            return rejected('host_not_foreground', `Image optimization is measured in the foreground only; the host is ${observed.profile}.`, document);
        }
        const sourcePath = document.path;
        const sourceFileRevision = document.fileRevision;
        let sourceFile;
        let exportRoot;
        let output;
        try {
            sourceFile = await inspectSourceFile(sourcePath);
            await this.exportStore.ensure();
            exportRoot = await resolveBackupRoot(this.exportStore.recordDirectory);
            output = await validateOutputPath(input.outputPath, 'ai', sourceFile.path, this.exportStore.stateRootPath);
        }
        catch (error) {
            if (error instanceof BackupPreconditionError) {
                return rejected(error.reason === 'backup_root_unavailable' ? 'export_root_unavailable' : 'source_file_unavailable', error.message, document);
            }
            if (error instanceof ExportPreconditionError)
                return rejected(error.reason, error.message, document);
            throw error;
        }
        return await withBackupRootScope(exportRoot, async (rootScope) => await withOutputParentScope(output.parent, async (parentScope) => {
            const exportId = newExportId();
            const workCopyPath = join(exportRoot, workCopyFileName(exportId, sourceFile.path));
            const renderBeforeBase = join(exportRoot, `${exportId}-render-before`);
            const renderAfterBase = join(exportRoot, `${exportId}-render-after`);
            assertRenderBaseName(renderBeforeBase);
            assertRenderBaseName(renderAfterBase);
            stage = 'copy_work';
            let copied;
            try {
                copied = await copyFileExclusive(sourceFile.path, workCopyPath, sourceFile.identity);
                files.workCopyPath = workCopyPath;
            }
            catch (error) {
                if (copyErrorCreatedDestination(error))
                    files.workCopyPath = workCopyPath;
                if (error instanceof BackupCopyError)
                    return failed('copy_mismatch', error.message);
                return asIndeterminate(error);
            }
            let staging;
            try {
                await parentScope.assertStable();
                staging = await createStagingDirectory(output.parent, exportId, output.path);
            }
            catch (error) {
                if (error instanceof ExportPreconditionError)
                    return rejected(error.reason, error.message, document);
                return asIndeterminate(error);
            }
            const stagedPath = staging.stagedPath;
            const sessionPaths = [workCopyPath, stagedPath, output.path];
            const removeRenders = async () => {
                let removed = true;
                for (const path of [`${renderBeforeBase}.png`, `${renderAfterBase}.png`]) {
                    try {
                        await unlink(path);
                    }
                    catch (error) {
                        if (error.code !== 'ENOENT')
                            removed = false;
                    }
                }
                if (removed)
                    files.renderFiles = [];
                return removed;
            };
            stage = 'open_session';
            let session = null;
            let opened;
            try {
                const result = await timed('open', async () => await this.executeHost({
                    kind: 'read',
                    script: IMAGE_OPTIMIZE_VERSION_GUARD + EXPORT_OPEN_WORK_COPY_SCRIPT,
                    params: { expectedDocumentKey: admittedKey, workCopyPath, stagedPath, outputPath: output.path, sessionPaths },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        beforeHost: async ({ commandId }) => {
                            await this.#leaseGuard.assertNoUnresolvedSession();
                            await rootScope.assertStable();
                            await parentScope.assertStable();
                            await verifyTrackedFile(workCopyPath, copied.identity, copied.sha256);
                            await assertOutputAbsent(output.path);
                            await assertOutputAbsent(stagedPath);
                            const lease = {
                                version: 1,
                                exportId,
                                documentKey: input.expectedDocumentKey,
                                sourcePath: sourceFile.path,
                                format: 'ai',
                                workCopyPath,
                                workCopyIdentity: serializeFileIdentity(copied.identity),
                                stagingDirectory: staging.directory,
                                stagedPath,
                                outputPath: output.path,
                                bytes: copied.bytes,
                                sha256: copied.sha256,
                                openCommandId: commandId,
                                phase: 'open_pending',
                                createdAt: new Date().toISOString(),
                            };
                            await this.exportStore.openSession(lease);
                            session = lease;
                            sessionId = exportId;
                            stage = 'open_work_copy';
                        },
                        afterHost: async ({ commandId, data }) => {
                            const result = data;
                            await this.exportStore.writeHostRecord({
                                version: 1,
                                exportId,
                                openCommandId: commandId,
                                workCopy: hostRecordIdentityOf(result.opened),
                                artboardRects: artboardRectsOf(source.artboards),
                                recordedAt: new Date().toISOString(),
                            });
                        },
                    },
                }));
                opened = result.data;
            }
            catch (error) {
                if (session === null) {
                    if (isLeaseError(error))
                        throw error;
                    if (error instanceof BackupCopyError)
                        return failed('file_replaced', error.message);
                    if (error instanceof ExportPreconditionError)
                        return rejected(error.reason, error.message, document);
                    return asIndeterminate(error);
                }
                if (error instanceof IndeterminateExecutionError)
                    return asIndeterminate(error);
                const detail = parseExportHostError(error);
                if (detail?.code !== undefined && EXPORT_OPEN_PRE_ATTEMPT_CODES.includes(detail.code)) {
                    const release = await this.releaseExportViaInventory(session);
                    if (release !== 'released')
                        return indeterminate(`Work-copy open failed (${detail.code}) and the lease could not be released (${release}).`);
                    sessionId = null;
                    if (detail.code === 'DOCUMENT_MISMATCH' || detail.code === 'DOCUMENT_NOT_SAVED') {
                        return failed('source_changed', `The source document changed before the work copy was opened (${detail.code}).`);
                    }
                    return failed('work_copy_open_failed', `The work copy could not be opened (${detail.code}).`);
                }
                return asIndeterminate(error);
            }
            if (session === null)
                return indeterminate('The open command completed without publishing its lease.');
            const lease = session;
            if (opened.source.key !== admittedKey || (opened.opened.path === null || !sameFilePath(opened.opened.path, workCopyPath)) ||
                opened.opened.key === admittedKey || opened.documentCountAfter !== opened.documentCountBefore + 1) {
                return indeterminate('Illustrator reported an unexpected document inventory after opening the work copy.');
            }
            const workCopyPaths = [workCopyPath, stagedPath];
            const workIdentity = { colorSpace: document.colorSpace, artboardRects: source.artboardRects, pageItems: source.pageItems, rasterItems: source.rasterItems };
            let gateFailure = null;
            stage = 'baseline';
            let baseline = null;
            try {
                const result = await timed('baseline', async () => await this.executeHost({
                    kind: 'read',
                    script: IMAGE_OPTIMIZE_BASELINE_SCRIPT,
                    params: { workCopyPaths, workIdentity, maxScannedImages: IMAGE_OPTIMIZE_MAX_SCANNED_IMAGES, renderBeforeBase, renderScalePercent: render.scalePercent },
                    timeoutMs: IMAGE_OPTIMIZE_HOST_TIMEOUT_MS,
                    hostGate: { beforeHost: async () => { await rootScope.assertStable(); } },
                }));
                baseline = result.data;
                files.renderFiles.push(baseline.render.path);
            }
            catch (error) {
                if (error instanceof IndeterminateExecutionError)
                    return asIndeterminate(error);
                const detail = parseExportHostError(error);
                if (detail?.code !== undefined && IMAGE_OPTIMIZE_BASELINE_CODES.includes(detail.code)) {
                    gateFailure = { reason: 'work_copy_mismatch', stage: 'baseline', message: `The baseline step was refused (${detail.code}).`, details: [] };
                }
                else {
                    return asIndeterminate(error);
                }
            }
            if (baseline !== null) {
                const differences = workCopyDifferences(source.rasters, baseline.rasters);
                if (differences.length > 0) {
                    gateFailure = { reason: 'work_copy_mismatch', stage: 'baseline', message: 'The opened work copy does not hold the rasters read from the source.', details: differences };
                }
            }
            let rasterized = null;
            const verified = [];
            let comparison = null;
            let renderDiff = null;
            let renderComparisonFailed = false;
            if (gateFailure === null && baseline !== null) {
                stage = 'rasterize';
                const workTargets = targets.map((target) => {
                    const facts = baseline.rasters[target.index].facts;
                    return { uuid: facts.uuid, name: facts.name, layer: facts.layer, bounds: facts.bounds };
                });
                try {
                    const result = await timed('rasterize', async () => await this.executeHost({
                        kind: 'read',
                        script: IMAGE_OPTIMIZE_RASTERIZE_SCRIPT,
                        params: { workCopyPaths, workIdentity, targets: workTargets, geometryTolerance: IMAGE_OPTIMIZE_GEOMETRY_TOLERANCE_PT, capPpi: input.capPpi, renderAfterBase, renderScalePercent: render.scalePercent },
                        timeoutMs: IMAGE_OPTIMIZE_HOST_TIMEOUT_MS,
                        hostGate: { beforeHost: async () => { await rootScope.assertStable(); } },
                    }));
                    rasterized = result.data;
                }
                catch (error) {
                    return asIndeterminate(error);
                }
                if (rasterized.render !== null)
                    files.renderFiles.push(rasterized.render.path);
                if (rasterized.errors.length > 0) {
                    const first = rasterized.errors[0];
                    gateFailure = {
                        reason: 'rasterize_failed', stage: 'rasterize', message: `Rasterize failed at ${first.stage} for ${first.uuid || 'the render'}: ${first.message}`,
                        details: rasterized.errors.map((entry) => `${entry.uuid} ${entry.stage}: ${entry.message}`),
                    };
                }
                else {
                    stage = 'verify_result';
                    const problems = [];
                    if (rasterized.results.length !== targets.length)
                        problems.push(`${rasterized.results.length} of ${targets.length} targets returned`);
                    for (const [position, entry] of rasterized.results.entries()) {
                        if (entry.sourceUuid !== workTargets[position]?.uuid)
                            problems.push(`result ${position} is for ${entry.sourceUuid}`);
                        const judged = verifyTargetResult(entry, input.capPpi);
                        if (judged.target === null)
                            problems.push(...judged.problems.map((problem) => `${targets[position]?.uuid ?? entry.sourceUuid}: ${problem}`));
                        else
                            verified.push({ ...judged.target, sourceUuid: targets[position].uuid });
                    }
                    if (deepDifferences(source.artboards, rasterized.artboards, '$.artboards').length > 0)
                        problems.push('the artboards changed');
                    if (problems.length > 0) {
                        gateFailure = { reason: 'verification_failed', stage: 'verify_result', message: 'The rasterized work copy does not match the plan.', details: problems };
                    }
                    else {
                        try {
                            renderDiff = await comparePngImages({
                                beforePath: `${renderBeforeBase}.png`, afterPath: `${renderAfterBase}.png`, threshold: IMAGE_OPTIMIZE_QUALITY_CONTRACT.channelThreshold,
                                origin: 'private_state',
                            });
                            comparison = renderDiff.result.comparison;
                            const quality = renderQualityProblem(comparison);
                            if (quality !== null) {
                                renderComparisonFailed = true;
                                gateFailure = { reason: 'render_quality_exceeded', stage: 'verify_result', message: quality, details: [] };
                            }
                            else {
                                renderDiff = null;
                            }
                        }
                        catch (error) {
                            renderComparisonFailed = true;
                            gateFailure = { reason: 'verification_failed', stage: 'verify_result', message: `The renders could not be compared: ${error instanceof Error ? error.message : String(error)}`, details: [] };
                        }
                    }
                }
            }
            let saved = null;
            if (gateFailure === null) {
                stage = 'save_output';
                try {
                    const result = await timed('save', async () => await this.executeHost({
                        kind: 'read',
                        script: IMAGE_OPTIMIZE_SAVE_SCRIPT,
                        params: { workCopyPaths, workIdentity, stagedPath, outputPath: output.path, saveOptions },
                        timeoutMs: IMAGE_OPTIMIZE_HOST_TIMEOUT_MS,
                        hostGate: {
                            beforeHost: async () => {
                                await rootScope.assertStable();
                                await parentScope.assertStable();
                                await assertOutputAbsent(output.path);
                                await assertOutputAbsent(stagedPath);
                            },
                        },
                    }));
                    saved = result.data;
                }
                catch (error) {
                    if (error instanceof IndeterminateExecutionError)
                        return asIndeterminate(error);
                    if (error instanceof ExportPreconditionError) {
                        gateFailure = { reason: 'save_failed', stage: 'save_output', message: `${error.message} (nothing was sent to Illustrator).`, details: [] };
                    }
                    else {
                        const detail = parseExportHostError(error);
                        if (detail?.code === 'OPTIMIZE_WORK_COPY_NOT_UNIQUE' || detail?.code === 'OPTIMIZE_WORK_COPY_IDENTITY_MISMATCH')
                            return asIndeterminate(error);
                        if (detail?.code !== undefined && IMAGE_OPTIMIZE_SAVE_PRE_ATTEMPT_CODES.includes(detail.code)) {
                            gateFailure = { reason: 'save_failed', stage: 'save_output', message: `The save was refused before any write (${detail.code}).`, details: [] };
                        }
                        else if (detail?.code === IMAGE_OPTIMIZE_SAVE_FAILED_CODE) {
                            if (detail.outputExists === true)
                                return indeterminate(`Illustrator reported a save error but the output file exists: ${detail.message ?? ''}`);
                            gateFailure = { reason: 'save_failed', stage: 'save_output', message: `Illustrator refused the save: ${detail.message ?? 'unknown error'}`, details: [] };
                        }
                        else {
                            return asIndeterminate(error);
                        }
                    }
                }
                if (saved !== null) {
                    files.stagedPath = stagedPath;
                    if (!sameFilePath(saved.pathAfter, stagedPath))
                        return indeterminate(`Illustrator reported an unexpected document path after saving (${saved.pathAfter}).`);
                }
            }
            let verification = null;
            if (saved !== null && gateFailure === null) {
                stage = 'verify_output';
                try {
                    verification = await verifyOutputFile(stagedPath, saveOptions.pdfCompatible ? source.artboards.length : null, () => syncDirectory(staging.directory));
                    if (saveOptions.pdfCompatible !== (verification.imageObjects > 0)) {
                        gateFailure = {
                            reason: 'output_verification_failed', stage: 'verify_output',
                            message: `The output has ${verification.imageObjects} PDF image object(s), which contradicts pdfCompatible=${saveOptions.pdfCompatible}.`, details: [],
                        };
                    }
                }
                catch (error) {
                    if (error instanceof OutputVerificationError)
                        gateFailure = { reason: 'output_verification_failed', stage: 'verify_output', message: error.message, details: [] };
                    else
                        return asIndeterminate(error);
                }
            }
            stage = 'close_work_copy';
            let closed;
            try {
                const result = await timed('close', async () => await this.executeHost({
                    kind: 'read',
                    script: IMAGE_OPTIMIZE_CLOSE_WORK_COPY_SCRIPT,
                    params: { workCopyPaths, workIdentity, sessionPaths, sourcePath, expectedDocumentKey: admittedKey, sourceFileRevision },
                    timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                    hostGate: {
                        afterHost: async ({ data }) => {
                            const result = data;
                            if (result.documentCount !== opened.documentCountBefore) {
                                throw new Error('Illustrator reported an unexpected document inventory after closing the work copy.');
                            }
                            if ((await matchingDocumentPaths(result, sessionPaths)).length !== 0)
                                throw new Error('A session document remains open; the export lease is kept.');
                            await this.releaseExportLeaseOnEvidence(lease, 0);
                            sessionId = null;
                        },
                    },
                }));
                closed = result.data;
            }
            catch (error) {
                return asIndeterminate(error);
            }
            stage = 'verify_source';
            if (closed.source.key !== admittedKey || !closed.source.saved || closed.source.fileRevision !== sourceFileRevision) {
                await removeRenders();
                return failed('source_changed', 'The source document no longer matches its pre-optimization identity.');
            }
            let sourceAfter;
            try {
                sourceAfter = await inspectSourceFile(sourcePath);
            }
            catch (error) {
                if (error instanceof BackupPreconditionError)
                    return failed('source_changed', error.message);
                throw error;
            }
            if (sourceAfter.path !== sourceFile.path || !await sameFileOrSameBytes(sourceFile.path, sourceAfter.identity, sourceFile.identity, copied.sha256)) {
                await removeRenders();
                return failed('source_changed', 'The source file changed during the optimization.');
            }
            if (renderComparisonFailed && gateFailure !== null) {
                try {
                    const images = renderDiff?.images ?? {
                        before: (await readStableImage(`${renderBeforeBase}.png`, 'before')).bytes,
                        after: (await readStableImage(`${renderAfterBase}.png`, 'after')).bytes,
                    };
                    evidenceDirectory = await retainImageOptimizeEvidence(this.exportStore.stateRootPath, {
                        ...images,
                        summary: { exportId, capturedAt: new Date().toISOString(), reason: gateFailure.reason,
                            message: gateFailure.message, qualityContract: IMAGE_OPTIMIZE_QUALITY_CONTRACT,
                            comparison: renderDiff?.result ?? null },
                    });
                }
                catch (error) {
                    if (error instanceof ImageOptimizeEvidenceError && error.directory !== null)
                        evidenceDirectory = error.directory;
                    gateFailure.details.push(`Render evidence could not be fully retained: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            const renderFilesRemoved = await removeRenders();
            if (gateFailure !== null) {
                if (saved === null)
                    await rmdir(staging.directory).catch(() => undefined);
                stage = gateFailure.stage;
                return failed(gateFailure.reason, gateFailure.message, gateFailure.details);
            }
            if (verification === null || comparison === null) {
                stage = 'verify_output';
                return failed('output_verification_failed', 'The output file was not verified.');
            }
            stage = 'publish_output';
            let published;
            try {
                await rootScope.assertStable();
                await parentScope.assertStable();
                await verifyOutputUnchanged(stagedPath, verification);
                published = await publishOutput(stagedPath, output.path, verification, parentScope);
                files.outputPath = output.path;
                if (published.stagingRemoved)
                    files.stagedPath = null;
                await verifyOutputUnchanged(output.path, { ...verification, identity: published.identity });
            }
            catch (error) {
                if (error instanceof OutputPublishError)
                    return failed(error.reason, error.message);
                if (error instanceof BackupCopyError)
                    return failed('file_replaced', error.message);
                return asIndeterminate(error);
            }
            stage = 'cleanup';
            const workCopyRemoved = await removeRestoreTestFile(workCopyPath, copied.identity, rootScope);
            if (workCopyRemoved)
                files.workCopyPath = null;
            return {
                outcome: 'verified',
                document,
                exportId,
                capPpi: input.capPpi,
                output: { path: output.path, bytes: verification.bytes, sha256: verification.sha256, imageObjects: verification.imageObjects },
                bytes: {
                    source: Number(sourceFile.identity.size),
                    optimized: verification.bytes,
                    savedAgainstSource: Number(sourceFile.identity.size) - verification.bytes,
                    ratioAgainstSource: Number((verification.bytes / Number(sourceFile.identity.size)).toFixed(6)),
                },
                save: saveOptions,
                iccProfile,
                targets: verified,
                excluded,
                render: { ppi: input.capPpi, width: render.width, height: render.height, comparison },
                workCopy: { path: workCopyPath, removed: workCopyRemoved },
                staging: { directory: staging.directory, removed: published.stagingRemoved },
                renderFilesRemoved,
                sourcePreserved: true,
                timing: { totalMs: Math.round(performance.now() - startedAt), hostMs },
            };
        }));
    }
    async releaseExportViaInventory(session) {
        let released = false;
        let inventory;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: EXPORT_INVENTORY_SCRIPT,
                params: { sessionPaths: exportSessionPaths(session) },
                hostGate: {
                    beforeHost: async () => {
                        if (await this.exportStore.readSession(session.exportId) === null)
                            throw new ExportSessionGoneError(session.exportId);
                    },
                    afterHost: async ({ data }) => {
                        const result = data;
                        if ((await matchingDocumentPaths(result, exportSessionPaths(session))).length !== 0)
                            return;
                        await this.releaseExportLeaseOnEvidence(session, 0);
                        released = true;
                    },
                },
            });
            inventory = result.data;
        }
        catch (error) {
            if (error instanceof ExportSessionGoneError)
                return 'session_gone';
            throw error;
        }
        if (released)
            return 'released';
        return (await matchingDocumentPaths(inventory, exportSessionPaths(session))).length === 0 ? 'release_refused' : 'work_copy_open';
    }
    async reconcileExport(input) {
        const saveAsLease = await this.#saveAs.store.read(input.exportId, 'session');
        if (saveAsLease.state === 'valid' || (saveAsLease.state === 'invalid' && await this.#saveAs.store.isSaveAsLease(input.exportId))) {
            throw new Error(`${input.exportId} is an illustrator_save_document_as session; run illustrator_reconcile_save_as with save_as_id=${input.exportId}.`);
        }
        if (await isBatchExportId(this.exportStore, input.exportId)) {
            return await new RasterBatchExportReconciler({ bridge: this.bridge, exportStore: this.exportStore }).reconcile(input);
        }
        if (await this.isRasterExport(input.exportId)) {
            return await this.reconcileRasterExport({ exportId: input.exportId, action: input.action,
                ...(input.confirmExportId === undefined ? {} : { confirmExportId: input.confirmExportId }) });
        }
        if (input.action !== 'inspect' && input.action !== 'close_work_copy') {
            throw new Error(`action ${input.action} applies to illustrator_export sessions only; export ${input.exportId} is not one.`);
        }
        if (input.confirmExportId !== undefined)
            throw new Error('confirm_export_id applies to illustrator_export sessions only.');
        const session = await this.exportStore.readSession(input.exportId);
        if (session === null)
            return { status: 'no_session', exportId: input.exportId };
        const sessionPaths = exportSessionPaths(session);
        let released = false;
        let inventory;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: EXPORT_INVENTORY_SCRIPT,
                params: { sessionPaths },
                hostGate: {
                    beforeHost: async () => {
                        if (await this.exportStore.readSession(session.exportId) === null)
                            throw new ExportSessionGoneError(session.exportId);
                    },
                    afterHost: async ({ data }) => {
                        const result = data;
                        if ((await matchingDocumentPaths(result, exportSessionPaths(session))).length !== 0)
                            return;
                        await this.releaseExportLeaseOnEvidence(session, 0);
                        released = true;
                    },
                },
            });
            inventory = result.data;
        }
        catch (error) {
            if (error instanceof ExportSessionGoneError)
                return { status: 'no_session', exportId: input.exportId };
            throw error;
        }
        const matchedDocuments = await matchingDocumentPaths(inventory, sessionPaths);
        const open = {
            status: 'work_copy_open', exportId: session.exportId, workCopyPath: session.workCopyPath, outputPath: session.outputPath,
            documents: matchedDocuments, documentCount: inventory.documentCount,
        };
        if (released) {
            return {
                status: 'released', exportId: session.exportId, action: 'inspect', workCopyPath: session.workCopyPath,
                outputPath: session.outputPath, documentCount: inventory.documentCount, closedDocument: null,
            };
        }
        if (input.action === 'inspect' || matchedDocuments.length !== 1)
            return open;
        const refused = (reason) => ({ ...open, status: 'close_refused', reason });
        const hostRecord = await this.exportStore.readHostRecord(session.exportId);
        if (hostRecord === null)
            return refused('host_record_unavailable');
        const target = matchedDocuments[0];
        const provenance = {
            workCopyPath: session.workCopyPath,
            stagedPath: session.stagedPath,
            colorSpace: hostRecord.workCopy.colorSpace,
            artboardRects: hostRecord.artboardRects,
            fileRevisionAtOpen: hostRecord.workCopy.fileRevision,
        };
        const refusal = closeRefusalReason(target, provenance);
        if (refusal !== null)
            return refused(refusal);
        let closed;
        try {
            const result = await this.executeHost({
                kind: 'read',
                script: EXPORT_RECONCILE_CLOSE_SCRIPT,
                params: { sessionPaths, expected: target, provenance },
                timeoutMs: EXPORT_HOST_TIMEOUT_MS,
                hostGate: {
                    beforeHost: async () => {
                        if (await this.exportStore.readSession(session.exportId) === null)
                            throw new ExportSessionGoneError(session.exportId);
                    },
                    afterHost: async ({ data }) => {
                        const result = data;
                        if ((await matchingDocumentPaths(result, exportSessionPaths(session))).length !== 0)
                            return;
                        await this.releaseExportLeaseOnEvidence(session, 0);
                        released = true;
                    },
                },
            });
            closed = result.data;
        }
        catch (error) {
            if (error instanceof ExportSessionGoneError)
                return { status: 'no_session', exportId: input.exportId };
            const detail = parseExportHostError(error);
            if (detail?.code === EXPORT_CLOSE_REFUSED_CODE)
                return refused(typeof detail.reason === 'string' ? detail.reason : 'host_refused');
            throw error;
        }
        if (!released) {
            return {
                status: 'work_copy_open', exportId: session.exportId, workCopyPath: session.workCopyPath, outputPath: session.outputPath,
                documents: await matchingDocumentPaths(closed, sessionPaths), documentCount: closed.documentCount,
            };
        }
        return {
            status: 'released', exportId: session.exportId, action: 'close_work_copy', workCopyPath: session.workCopyPath,
            outputPath: session.outputPath, documentCount: closed.documentCount, closedDocument: closed.closed,
        };
    }
    async observeEditSessionHostProfile() {
        const observation = this.hostProfileProbe.observeForEditSession
            ? await this.hostProfileProbe.observeForEditSession()
            : await this.hostProfileProbe.observe();
        return observation.profile === 'foreground' ? 'foreground_unlocked' : observation.profile;
    }
    reportingReadGate(source = 'document') {
        return this.editSessionHostGate(false, false, undefined, false, { source });
    }
    editSessionHostGate(mutation, foregroundGuarded = false, adapterBeforeHost, dirtyFile = false, clean = { source: 'document' }) {
        const barriers = this.bridge.releaseBarrierStore?.() ?? null;
        let observed = null;
        const hostProfile = () => !mutation
            ? Promise.resolve('unknown')
            : foregroundGuarded ? Promise.resolve('foreground_unlocked') : (observed ??= this.observeEditSessionHostProfile());
        const early = mutation && !foregroundGuarded
            ? this.#editSessions.hasRecords().then((exists) => { if (exists)
                void hostProfile().catch(() => undefined); }, () => undefined)
            : Promise.resolve();
        return {
            beforeHost: async () => {
                if (mutation)
                    await this.#leaseGuard.assertNoUnresolvedSession();
                if (adapterBeforeHost !== undefined)
                    await adapterBeforeHost();
                await early;
                const admission = await this.#editSessions.admissionInput(hostProfile, { strict: mutation });
                const dirty = barriers !== null ? await buildDirtyFileAdmission(barriers, this.#editSessions.store, dirtyFile) : undefined;
                if (admission === undefined && dirty === undefined)
                    return undefined;
                return { ...(admission === undefined ? {} : { editSessionAdmission: admission }), ...(dirty === undefined ? {} : { dirtyFileAdmission: dirty }) };
            },
            ...(!mutation && barriers !== null ? { afterHost: async ({ data }) => {
                    if (clean.validate !== undefined && !clean.validate(data))
                        return;
                    await barriers.observeClean(data, clean.source);
                } } : {}),
        };
    }
    async getEditSessions() {
        return listEditSessionsResult(await this.#editSessions.store.list());
    }
    async openEditSession(input) {
        let scan = null;
        const rejected = (reason, message) => ({ outcome: 'rejected', reason, message: message +
                (reason === 'unmeasured_host_state' ? ' ' + EDIT_SESSION_FOREGROUND_HINT : '') +
                (reason === 'not_saved_file' ? ' ' + NOT_SAVED_FILE_SESSION_HINT : '') +
                (reason === 'document_too_large' ? ' ' + editSessionTooLargeNote(scan?.total ?? null) : '') +
                (['scan_too_slow', 'scan_time_limit', 'scan_call_limit', 'scan_no_progress'].includes(reason) ? ' ' + EDIT_SESSION_RESTART_HINT : '') });
        const toolStarted = this.#openScans.now();
        let outcome = null;
        try {
            const activeScan = this.#openScans.start(input);
            scan = activeScan;
            const refuse = (reason, message) => {
                throw new EditSessionOpenRejectedError(rejected(reason, message));
            };
            const preconditions = async (fullHash) => {
                await this.#leaseGuard.assertNoUnresolvedSession();
                let backup;
                try {
                    backup = await this.backupStore.readRecord(input.backupId);
                }
                catch (error) {
                    if (error instanceof BackupRecordError)
                        return refuse('backup_invalid', error.message);
                    throw error;
                }
                if (backup === null)
                    return refuse('backup_not_found', 'Run illustrator_create_backup first.');
                if (activeScan.backup !== null && !isDeepStrictEqual(backup, activeScan.backup))
                    return refuse('backup_mismatch', 'The backup record changed during the scan.');
                activeScan.backup = backup;
                const entries = await this.#editSessions.store.list();
                if (entries.some((entry) => entry.read.state === 'invalid'))
                    return refuse('session_record_invalid', 'An edit session record is unreadable.');
                const active = entries.find((entry) => entry.read.state === 'valid' && entry.read.record.state !== 'closed' && sameFilePath(entry.read.record.sourcePath, backup.sourcePath));
                if (active !== undefined && active.read.state === 'valid') {
                    return refuse('active_session_exists', `The file already has an edit session that is ${active.read.record.state} (${active.read.record.sessionId}). ${USER_SAVED_SESSION_HINT}`);
                }
                let facts = null;
                let sourceIdentity;
                let real;
                try {
                    real = await realpath(backup.sourcePath);
                    if (!sameFilePath(real, backup.sourcePath))
                        return refuse('path_not_canonical', 'Open the file by its canonical path.');
                    await assertSameFilePathIdentity(backup.sourcePath, real);
                    if (fullHash)
                        facts = await readFileFacts(real);
                    sourceIdentity = facts?.identity ?? await readEditSessionScanIdentity(real);
                }
                catch (error) {
                    if (error instanceof EditSessionOpenRejectedError)
                        throw error;
                    return refuse('source_file_unavailable', error instanceof Error ? error.message : String(error));
                }
                const inode = { dev: sourceIdentity.dev.toString(), ino: sourceIdentity.ino.toString() };
                if ((facts !== null && (facts.sha256 !== backup.sha256 || facts.bytes !== backup.bytes)) ||
                    (activeScan.sourceIdentity !== null && !isDeepStrictEqual(sourceIdentity, activeScan.sourceIdentity))) {
                    return refuse('backup_mismatch', 'The source bytes or identity changed; no session was created.');
                }
                activeScan.sourceIdentity = sourceIdentity;
                let backupFacts = null;
                let backupIdentity;
                try {
                    if (fullHash)
                        backupFacts = await readFileFacts(backup.backupPath);
                    backupIdentity = backupFacts?.identity ?? await readEditSessionScanIdentity(backup.backupPath);
                }
                catch (error) {
                    return refuse('backup_invalid', error instanceof Error ? error.message : String(error));
                }
                if ((backupFacts !== null && (backupFacts.sha256 !== backup.sha256 || backupFacts.bytes !== backup.bytes)) ||
                    (activeScan.backupIdentity !== null && !isDeepStrictEqual(backupIdentity, activeScan.backupIdentity))) {
                    return refuse('backup_invalid', 'The backup bytes or identity no longer match the initial verified record.');
                }
                activeScan.backupIdentity = backupIdentity;
                if (await this.observeEditSessionHostProfile() !== 'foreground_unlocked')
                    return refuse('unmeasured_host_state', 'Edit sessions require the measured foreground and unlocked host state.');
                return { backup, facts, inode, real };
            };
            for (;;) {
                this.#openScans.checkLimits(activeScan);
                if (this.#openScans.now() - toolStarted + this.#scanTiming.deadlineMs + EDIT_SESSION_SCAN_MARGIN_MS > this.#scanTiming.toolWallMs) {
                    return { outcome: 'scan_in_progress', scan_continuation: this.#openScans.continue(activeScan),
                        progress: { items: activeScan.partial.visited, total: activeScan.total, calls: activeScan.calls,
                            elapsedMs: this.#openScans.now() - activeScan.startedAt, estimatedRemainingMs: activeScan.estimatedRemainingMs } };
                }
                await this.executeHost({
                    kind: 'read', script: EDIT_SESSION_OPEN_SCRIPT, timeoutMs: EDIT_SESSION_CHUNK_TIMEOUT_MS,
                    params: { expectedDocumentKey: input.expectedDocumentKey, cursor: activeScan.cursor,
                        scanOptions: { budgetMs: this.#scanTiming.budgetMs, deadlineMs: this.#scanTiming.deadlineMs,
                            maxItems: EDIT_SESSION_CHUNKED_MAX_ITEMS, maxRows: EDIT_SESSION_CHUNKED_MAX_ITEMS,
                            loMaxRows: EDIT_SESSION_CHUNKED_MAX_ITEMS, expectStructure: activeScan.structure?.digest ?? null } },
                    hostGate: {
                        beforeHost: async () => { await preconditions(activeScan.calls === 0); this.#openScans.checkLimits(activeScan); },
                        afterHost: async ({ data }) => {
                            const chunk = editSessionChunkSchema.parse(JSON.parse(String(data)));
                            this.#openScans.accept(activeScan, chunk);
                            for (const context of [chunk.contextStart, chunk.contextEnd]) {
                                try {
                                    await assertSameFilePathIdentity(context.path, activeScan.backup.sourcePath);
                                }
                                catch {
                                    return refuse('backup_mismatch', 'The reported path and backup do not identify the same source file entry.');
                                }
                            }
                            if (!chunk.done)
                                return;
                            const { backup, inode, facts, real } = await preconditions(true);
                            const context = chunk.contextEnd;
                            const opened = await this.#editSessions.store.open({
                                backupId: backup.backupId, openingDocumentKey: context.key, backup,
                                observed: {
                                    sourcePath: real, sourceInode: inode, sourceSha256: facts.sha256,
                                    documentKey: context.key, mutationProfile: context.mutationProfile, saved: context.saved,
                                    sourceFileRevision: context.fileRevision, structure: activeScan.structure, structureStable: true,
                                    scan: { aggregate: chunkedAggregateText(activeScan), total: activeScan.total, visited: activeScan.partial.visited,
                                        missingUuid: activeScan.partial.missingUuid, unmeasured: activeScan.partial.unmeasured, truncated: false,
                                        overLimit: false, layerRows: activeScan.partial.n - activeScan.partial.visited, durationMs: activeScan.partial.durationMs },
                                    hostProfile: 'foreground_unlocked',
                                },
                            });
                            if (opened.outcome === 'refuse') {
                                outcome = rejected(opened.reason, 'The edit session was not opened: ' + opened.reason + '. Nothing was written.');
                                return;
                            }
                            outcome = { outcome: 'opened', session: summarizeEditSession(opened.record), document: context,
                                scan: { items: activeScan.partial.visited, scanMs: activeScan.partial.durationMs } };
                            if (context.path !== null)
                                await this.bridge.releaseBarrierStore?.()?.observeCleanScan(context.path);
                        },
                    },
                });
                if (outcome !== null)
                    return outcome;
            }
        }
        catch (error) {
            if (error instanceof EditSessionOpenRejectedError)
                return error.result;
            if (error instanceof EditSessionScanError || error instanceof EditSessionNotSavedFileError)
                return rejected(error.reason, error.message);
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH' || detail?.code === 'DOCUMENT_KEY_AMBIGUOUS') {
                return rejected(scan !== null && scan.calls > 0 ? 'document_changed_during_scan' : 'document_key_mismatch', lifecycleMismatchMessage(detail));
            }
            throw error;
        }
    }
    async closeEditSession(input) {
        if (input.confirmSessionId !== input.sessionId) {
            return { outcome: 'rejected', reason: 'confirmation_mismatch', message: 'confirm_session_id must exactly match session_id.' };
        }
        let outcome = null;
        await this.executeHost({
            kind: 'read',
            script: 'var result = { locked: true };',
            hostGate: {
                beforeHost: async () => {
                    const store = this.#editSessions.store;
                    const read = await store.read(input.sessionId);
                    if (input.action === 'close') {
                        if (read.state === 'missing') {
                            outcome = { outcome: 'rejected', reason: 'not_found', message: `Edit session ${input.sessionId} does not exist.` };
                            return;
                        }
                        if (read.state === 'invalid') {
                            outcome = { outcome: 'rejected', reason: 'record_invalid', message: `Edit session ${input.sessionId} is unreadable (${read.reason}); quarantine it with action=quarantine.` };
                            return;
                        }
                        outcome = { outcome: 'closed', session: summarizeEditSession(await store.close(input.sessionId)) };
                        return;
                    }
                    if (read.state === 'valid') {
                        outcome = { outcome: 'rejected', reason: 'record_valid', message: `Edit session ${input.sessionId} is readable; close it instead of quarantining it.` };
                        return;
                    }
                    try {
                        await store.quarantine(input.sessionId, { confirmSessionId: input.confirmSessionId });
                    }
                    catch (error) {
                        outcome = { outcome: 'rejected', reason: read.state === 'missing' ? 'not_found' : 'not_quarantinable', message: error instanceof Error ? error.message : String(error) };
                        return;
                    }
                    outcome = { outcome: 'quarantined', sessionId: input.sessionId };
                },
            },
        });
        if (outcome === null)
            throw new Error('The edit session close returned no decision.');
        return outcome;
    }
    async listSelection() {
        const result = await this.executeHost({
            kind: 'read',
            script: LIST_SELECTION_SCRIPT, hostGate: this.reportingReadGate(),
        });
        return result.data;
    }
    async executeAdapter(operation, input) {
        return (await this.executeAdapterWithHostVersion(operation, input)).response;
    }
    async executeAdapterWithHostVersion(operation, input) {
        const { hostFilePathForms: _forms, hostFilePathComponents: _components, hostDocumentPathBindings: _bindings, ...rawInput } = input;
        input = rawInput;
        let selectedAdapter = null;
        try {
            const registered = this.mutationAdapters.resolveOperation(operation);
            const target = this.bridge.applicationTarget?.() ?? null;
            const inventoryGuards = [];
            const services = { imageFileInspector: this.imageFileInspector, backupStore: this.backupStore,
                fontVerifier: { verify: async (names, bundleId) => {
                        const verification = await this.fontInventory.verify(await this.fontVerifier.verify(names, bundleId), target);
                        const guard = this.fontInventory.guard(verification, target);
                        if (guard !== null)
                            inventoryGuards.push(guard);
                        return verification;
                    } }, applicationBundleId: target?.bundleId ?? null };
            const policyOperation = registered.hostVersionOperation?.({ plan: { resource: input.resource } }) ?? null;
            if (policyOperation !== null) {
                const { hostVersionBackup: _backup, hostVersionChannel: _channel, ...request } = input;
                input = request.apply === true ? { ...request, hostVersionChannel: this.bridge.applicationTarget?.()?.channel ?? 'unknown' } : request;
            }
            if (typeof registered.admit === 'function')
                input = await registered.admit(input, services);
            if (policyOperation !== null && input.apply === true && typeof input.backupId === 'string') {
                const bound = input.backup;
                const record = bound === undefined ? await this.backupStore.readRecord(input.backupId) : null;
                const facts = bound ?? (record === null ? undefined : record);
                if (facts !== undefined) {
                    const { backupId, sourcePath, sourceFileRevision, bytes, sha256 } = facts;
                    input = { ...input, hostVersionBackup: { backupId, sourcePath, sourceFileRevision, bytes, sha256 } };
                }
            }
            const prepared = this.mutationAdapters.prepare(operation, input);
            const { adapter, canonicalRequestDigest } = prepared;
            const admitted = input;
            const command = { ...prepared.command, hostGate: this.editSessionHostGate(prepared.command.kind === 'mutation', prepared.command.kind === 'mutation' && prepared.command.mutationHostApplicationMode === 'foreground', async () => {
                    for (const guard of inventoryGuards)
                        await guard();
                    if (prepared.command.kind !== 'mutation')
                        return;
                    if (admitted.hostVersionBackup !== undefined && admitted.backup === undefined) {
                        const backup = await verifyDeleteBackup(this.backupStore, String(admitted.backupId));
                        if (canonicalSha256(backup) !== canonicalSha256(admitted.hostVersionBackup))
                            throw new Error('HOST_VERSION_BACKUP_STALE: Backup changed before dispatch.');
                    }
                    if (typeof adapter.beforeHost === 'function')
                        await adapter.beforeHost(admitted, services);
                }, DIRTY_FILE_ADMISSION_OPERATIONS.has(adapter.operation), { source: 'document', validate: (data) => adapter.resultSchema.safeParse(data).success }) };
            selectedAdapter = adapter;
            const applying = command.kind === 'mutation';
            if (applying) {
                if (typeof this.bridge.resolveTerminalAttestation !== 'function') {
                    throw new Error('Mutation bridge does not provide a trusted terminal attestation resolver.');
                }
                this.#operationSafetyRegistry.assertApplyReady(adapter.operation, {
                    class: adapter.safety.policy.class,
                    version: adapter.safety.policy.version,
                    registrationIdentity: adapter.safetyRegistrationIdentity,
                });
            }
            const result = await this.executeHost(command);
            const checkedResponse = adapter.tool.outputSchema.safeParse({ outcome: result.data, delivery: result.delivery });
            if (!checkedResponse.success) {
                throw new Error(`The result Illustrator returned for ${adapter.tool.name} failed the server's own consistency checks: ${summarizeValidationFailure(checkedResponse.error)}. ` +
                    (applying ? 'The change may already be in the document; inspect it before retrying.' : 'Nothing was changed.'));
            }
            const response = checkedResponse.data;
            const resolver = applying
                ? { resolve: this.bridge.resolveTerminalAttestation.bind(this.bridge) }
                : null;
            const outcome = response.outcome;
            const terminalState = applying ? adapter.classifyTerminal(outcome).state : null;
            if (applying && terminalState === null) {
                throw new Error('Applied mutation cannot produce a planning-only terminal state.');
            }
            const attestation = applying
                ? await resolver.resolve({
                    commandId: result.commandId,
                    operationId: adapter.operation,
                    documentKey: command.idempotency.documentKey,
                    validatorIdentity: adapter.validator.kind,
                    validatorVersion: adapter.validator.version,
                    canonicalRequestDigest,
                    terminalState: terminalState,
                    finalizedAt: response.delivery.finalizedAt,
                })
                : null;
            try {
                await adapter.assertSafetyConformance(outcome, canonicalRequestDigest, attestation, resolver);
            }
            catch (error) {
                if (!applying)
                    throw error;
                throw new PostHostConformanceError(result.commandId, terminalState, error);
            }
            return { response, hostVersion: this.planHostVersion(adapter, outcome, applying) };
        }
        catch (error) {
            if (error instanceof PostHostConformanceError || error instanceof HostVersionChannelRefusedError)
                throw error;
            if (error instanceof ProvenPreApplyFailureError) {
                const refusal = editSessionRefusal(error.hostMessage);
                if (refusal !== null)
                    throw refusal;
                throw preApplyRefusalError(error, selectedAdapter);
            }
            const detail = parseMcpError(error);
            if (detail?.code === 'DOCUMENT_MISMATCH')
                throw new DocumentMismatchError(detail.expected ?? '', detail.actual ?? '');
            if (selectedAdapter !== null)
                throw selectedAdapter.mapExecutionError(error, detail);
            throw error;
        }
    }
    planHostVersion(adapter, outcome, applying) {
        const policyOperation = adapter.hostVersionOperation?.(outcome) ?? null;
        if (policyOperation === null)
            return null;
        const document = outcome.document;
        return admitHostVersionPlan(policyOperation, document?.appVersion, this.bridge.applicationTarget?.()?.channel, { ...(document?.path === undefined ? {} : { documentPath: document.path }), refuse: !applying });
    }
    async saveRecipe(input) {
        return await saveRecipe(input, { store: this.recipeStore });
    }
    async listRecipes() {
        return await listRecipes({ store: this.recipeStore });
    }
    async planRecipe(input) {
        return await planRecipe(input, {
            store: this.recipeStore,
            executeBatch: async (operation, normalizedInput) => await this.executeAdapter(operation, normalizedInput),
        });
    }
    async runRecipe(input) {
        return await runRecipe(input, {
            store: this.recipeStore,
            authorityStore: this.recipeExecutionAuthorityStore,
            executeBatch: async (operation, normalizedInput) => await this.executeAdapter(operation, normalizedInput),
        });
    }
    async runM6P0AppearancePreviewRecipe(input) {
        const result = await executeM6P0AppearancePreviewRecipe(input, {
            authorityStore: this.recipeAuthorityStore,
            executeAppearance: async (appearanceInput) => await this.executeAdapter('set_path_appearance', appearanceInput),
        });
        return m6P0RecipeResultSchema.parse(result);
    }
    reconcile(options) {
        return this.bridge.reconcile(options);
    }
    async rasterExport(input) {
        const dependencies = {
            bridge: this.bridge,
            executeHost: this.executeHost.bind(this),
            hostProfileProbe: this.hostProfileProbe,
            exportStore: this.exportStore,
            assertNoUnresolvedLease: async () => { await this.#leaseGuard.assertNoUnresolvedSession(); },
            editSessionForPath: async (path) => await this.#editSessions.store.findActiveForPath(path),
        };
        const checked = (isBatchInput(input) ? rasterBatchInputSchema : rasterExportInputSchema).safeParse(input, { error: toolArgumentIssueMessage });
        if (!checked.success)
            throw new Error(formatToolArgumentError('illustrator_export', checked.error.issues));
        if (isBatchInput(input))
            return await new RasterBatchExportOperation(dependencies).run(input);
        return await new RasterExportOperation(dependencies).run(input);
    }
    async isRasterExport(exportId) {
        const entry = await this.exportStore.readSessionEntry(exportId);
        if (entry?.format === 'v2' || entry?.format === 'v3')
            return true;
        if (entry?.format === 'v1')
            return false;
        const set = await this.exportStore.readRasterRecordSet(exportId);
        if (Object.entries(set).some(([type, read]) => type !== 'session' && read.state === 'v2'))
            return true;
        return await lstat(rasterQuarantinePaths(this.exportStore.stateRootPath, exportId).manifest).then(() => true, () => false);
    }
    async reconcileRasterExport(input) {
        return await new RasterExportReconciler({ bridge: this.bridge, exportStore: this.exportStore }).reconcile(input);
    }
}
