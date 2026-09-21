import { z } from 'zod';
import { documentContextWithApplicationSchema } from './mutation-result-schema-core.js';
export const CREATE_DOCUMENT_ARTBOARD_TOLERANCE_PT = 0.01;
export const CREATE_DOCUMENT_MAX_DIMENSION_PT = 16_383;
export const CREATE_DOCUMENT_HOST_TIMEOUT_MS = 60_000;
const dimensionSchema = z.number().finite().positive().max(CREATE_DOCUMENT_MAX_DIMENSION_PT);
export const createDocumentPublicInputSchema = z.strictObject({
    color_space: z.enum(['RGB', 'CMYK']),
    width_pt: dimensionSchema.describe('Artboard width in points (0 < width <= 16383).'),
    height_pt: dimensionSchema.describe('Artboard height in points (0 < height <= 16383).'),
    artboard_name: z.string().min(1).max(255).optional().describe('Name for the single artboard; Illustrator keeps its default when omitted.'),
});
export function normalizeCreateDocumentPublicInput(input) {
    const value = createDocumentPublicInputSchema.parse(input);
    return {
        colorSpace: value.color_space,
        widthPt: value.width_pt,
        heightPt: value.height_pt,
        ...(value.artboard_name === undefined ? {} : { artboardName: value.artboard_name }),
    };
}
const existingDocumentSchema = z.strictObject({
    keyBefore: z.string().min(1),
    keyAfter: z.string().min(1),
    indexBefore: z.number().int().nonnegative(),
    indexAfter: z.number().int().nonnegative(),
    saved: z.boolean(),
    fileRevision: z.string().nullable(),
});
const inventorySchema = z.strictObject({
    countBefore: z.number().int().nonnegative(),
    countAfter: z.number().int().nonnegative(),
    createdIndex: z.number().int().nonnegative().nullable(),
    existingDocuments: z.array(existingDocumentSchema),
});
const createdDocumentSchema = z.strictObject({
    colorSpace: z.enum(['RGB', 'CMYK']),
    artboardName: z.string(),
    artboardBounds: z.array(z.number().finite()).length(4),
    layerCount: z.number().int().positive(),
});
export const createDocumentResultSchema = z.discriminatedUnion('outcome', [
    z.strictObject({
        outcome: z.literal('created'),
        document: documentContextWithApplicationSchema,
        created: createdDocumentSchema,
        inventory: inventorySchema,
    }),
    z.strictObject({
        outcome: z.literal('add_failed'),
        message: z.string().min(1),
        inventory: inventorySchema,
    }),
    z.strictObject({
        outcome: z.literal('rolled_back'),
        reason: z.enum(['verify_mismatch']),
        message: z.string().min(1),
        inventory: inventorySchema,
    }),
    z.strictObject({
        outcome: z.literal('rollback_failed'),
        reason: z.enum(['verify_mismatch']),
        message: z.string().min(1),
        rollbackMessage: z.string().min(1),
        inventory: inventorySchema,
    }),
]);
export const CREATE_DOCUMENT_SCRIPT = `
var CREATE_DOCUMENT_TOLERANCE_PT = ${CREATE_DOCUMENT_ARTBOARD_TOLERANCE_PT};

function createDocumentKeyWithoutIndex(key) {
  return key.replace(/\\|index=\\d+\\|/, "|index=*|");
}

function createDocumentIndexOf(doc) {
  for (var cursor = 0; cursor < app.documents.length; cursor++) {
    if (app.documents[cursor] === doc) return cursor;
  }
  return -1;
}

function createDocumentInventory() {
  var entries = [];
  for (var cursor = 0; cursor < app.documents.length; cursor++) {
    entries.push({ doc: app.documents[cursor], identity: getDocumentIdentity(app.documents[cursor], cursor) });
  }
  return entries;
}

function createDocumentNear(actual, expected) {
  return typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= CREATE_DOCUMENT_TOLERANCE_PT;
}

if (params.colorSpace !== "RGB" && params.colorSpace !== "CMYK") throw new Error("MCP_ERROR:" + stringifyJson({ code: "CREATE_DOCUMENT_INVALID_INPUT", message: "colorSpace must be RGB or CMYK." }));
if (typeof params.widthPt !== "number" || !(params.widthPt > 0) || typeof params.heightPt !== "number" || !(params.heightPt > 0)) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "CREATE_DOCUMENT_INVALID_INPUT", message: "widthPt and heightPt must be positive numbers." }));
}
if (params.artboardName !== undefined && (typeof params.artboardName !== "string" || params.artboardName.length < 1 || params.artboardName.length > 255)) {
  throw new Error("MCP_ERROR:" + stringifyJson({ code: "CREATE_DOCUMENT_INVALID_INPUT", message: "artboardName must be a string of 1 to 255 characters." }));
}

var createDocumentBefore = createDocumentInventory();
var createDocumentCountBefore = app.documents.length;
var createDocumentSpace = params.colorSpace === "CMYK" ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
var createDocumentPreviousInteraction = app.userInteractionLevel;
var createdDocument = null;
var createDocumentAddError = null;
var result;

function createDocumentExistingReport() {
  var report = [];
  for (var cursor = 0; cursor < createDocumentBefore.length; cursor++) {
    var entry = createDocumentBefore[cursor];
    var indexAfter = createDocumentIndexOf(entry.doc);
    var identityAfter = indexAfter >= 0 ? getDocumentIdentity(entry.doc, indexAfter) : null;
    report.push({
      keyBefore: entry.identity.key,
      keyAfter: identityAfter === null ? "" : identityAfter.key,
      indexBefore: cursor,
      indexAfter: indexAfter < 0 ? 0 : indexAfter,
      saved: identityAfter === null ? false : identityAfter.saved,
      fileRevision: identityAfter === null ? null : identityAfter.fileRevision
    });
  }
  return report;
}

function createDocumentExistingUnchanged() {
  for (var cursor = 0; cursor < createDocumentBefore.length; cursor++) {
    var entry = createDocumentBefore[cursor];
    var indexAfter = createDocumentIndexOf(entry.doc);
    if (indexAfter < 0) return "A pre-existing document disappeared from the collection.";
    var identityAfter = getDocumentIdentity(entry.doc, indexAfter);
    if (createDocumentKeyWithoutIndex(identityAfter.key) !== createDocumentKeyWithoutIndex(entry.identity.key)) {
      return "A pre-existing document identity changed apart from its collection index.";
    }
    if (identityAfter.saved !== entry.identity.saved) return "A pre-existing document changed its saved state.";
  }
  return null;
}

app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  try {
    createdDocument = app.documents.add(createDocumentSpace, params.widthPt, params.heightPt);
  } catch (addError) {
    createDocumentAddError = addError && addError.message ? String(addError.message) : String(addError);
  }
  if (createdDocument === null || createdDocument === undefined) {
    result = {
      outcome: "add_failed",
      message: createDocumentAddError === null ? "app.documents.add returned no document." : createDocumentAddError,
      inventory: { countBefore: createDocumentCountBefore, countAfter: app.documents.length, createdIndex: null, existingDocuments: createDocumentExistingReport() }
    };
  } else {
    var verifyMessage = null;
    var createdIndex = createDocumentIndexOf(createdDocument);
    var createdRect = null;
    try {
      if (String(createdDocument.typename) !== "Document") verifyMessage = "app.documents.add returned a " + String(createdDocument.typename) + ".";
      else if (app.documents.length !== createDocumentCountBefore + 1) verifyMessage = "The document count did not grow by exactly one.";
      else if (createdIndex !== 0) verifyMessage = "The created document is not at collection index 0.";
      else if (app.activeDocument !== createdDocument) verifyMessage = "The created document is not the active document.";
      else if (createdDocument.documentColorSpace !== createDocumentSpace) verifyMessage = "The created document color space does not match the request.";
      else if (createdDocument.artboards.length !== 1) verifyMessage = "The created document does not have exactly one artboard.";
      else {
        createdRect = createdDocument.artboards[0].artboardRect;
        if (!createDocumentNear(createdRect[0], 0) || !createDocumentNear(createdRect[1], params.heightPt) ||
            !createDocumentNear(createdRect[2], params.widthPt) || !createDocumentNear(createdRect[3], 0)) {
          verifyMessage = "The created artboard geometry does not match the requested size.";
        } else if (createdDocument.layers.length < 1) verifyMessage = "The created document has no layer.";
        else {
          if (params.artboardName !== undefined) {
            createdDocument.artboards[0].name = params.artboardName;
            if (String(createdDocument.artboards[0].name) !== params.artboardName) verifyMessage = "The artboard name did not read back as requested.";
          }
          if (verifyMessage === null) verifyMessage = createDocumentExistingUnchanged();
        }
      }
      if (verifyMessage === null) {
        // Result assembly shares this try: a failure here still rolls the created document back below.
        var createdIdentity = getDocumentIdentity(createdDocument, createdIndex);
        var createdContext = getDocumentContext();
        if (createdContext.key !== createdIdentity.key) verifyMessage = "The created document context does not match its identity.";
        else {
          result = {
            outcome: "created",
            document: createdContext,
            created: {
              colorSpace: createdIdentity.colorSpace,
              artboardName: String(createdDocument.artboards[0].name || ""),
              artboardBounds: [createdRect[0], createdRect[1], createdRect[2], createdRect[3]],
              layerCount: createdDocument.layers.length
            },
            inventory: { countBefore: createDocumentCountBefore, countAfter: app.documents.length, createdIndex: createdIndex, existingDocuments: createDocumentExistingReport() }
          };
        }
      }
    } catch (verifyError) {
      result = undefined;
      verifyMessage = "Verification or result assembly failed: " + (verifyError && verifyError.message ? String(verifyError.message) : String(verifyError));
    }
    if (verifyMessage !== null) {
      var rollbackMessage = null;
      try {
        createdDocument.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {
        rollbackMessage = "close threw: " + (closeError && closeError.message ? String(closeError.message) : String(closeError));
      }
      if (rollbackMessage === null && app.documents.length !== createDocumentCountBefore) rollbackMessage = "The document count was not restored after closing the created document.";
      if (rollbackMessage === null) rollbackMessage = createDocumentExistingUnchanged();
      var rollbackInventory = { countBefore: createDocumentCountBefore, countAfter: app.documents.length, createdIndex: createdIndex < 0 ? null : createdIndex, existingDocuments: createDocumentExistingReport() };
      if (rollbackMessage === null) {
        result = { outcome: "rolled_back", reason: "verify_mismatch", message: verifyMessage, inventory: rollbackInventory };
      } else {
        result = { outcome: "rollback_failed", reason: "verify_mismatch", message: verifyMessage, rollbackMessage: rollbackMessage, inventory: rollbackInventory };
      }
    }
  }
} finally {
  app.userInteractionLevel = createDocumentPreviousInteraction;
}
`;
