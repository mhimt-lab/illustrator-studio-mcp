export const JSX_RUNTIME = String.raw `
function stringifyJson(value) {
  if (value === null || value === undefined) return "null";
  var type = typeof value;
  if (type === "number" || type === "boolean") return String(value);
  if (type === "string") {
    var escaped = "";
    var hex = "0123456789abcdef";
    for (var stringIndex = 0; stringIndex < value.length; stringIndex++) {
      var characterCode = value.charCodeAt(stringIndex);
      if (characterCode === 34) escaped += '\\"';
      else if (characterCode === 92) escaped += "\\\\";
      else if (characterCode <= 31) {
        escaped += "\\u00" + hex.charAt((characterCode >> 4) & 15) + hex.charAt(characterCode & 15);
      } else escaped += value.charAt(stringIndex);
    }
    return '"' + escaped + '"';
  }
  if (value instanceof Array) {
    var arrayParts = [];
    for (var i = 0; i < value.length; i++) arrayParts.push(stringifyJson(value[i]));
    return "[" + arrayParts.join(",") + "]";
  }
  var objectParts = [];
  for (var key in value) {
    if (value.hasOwnProperty(key)) objectParts.push(stringifyJson(key) + ":" + stringifyJson(value[key]));
  }
  return "{" + objectParts.join(",") + "}";
}

function readJson(path) {
  var file = new File(path);
  file.encoding = "UTF-8";
  if (!file.open("r")) throw new Error("Cannot read " + path);
  var text = file.read();
  file.close();
  if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
  return eval("(" + text + ")");
}

function writeJsonNew(path, value) {
  var file = new File(path + ".tmp");
  if (!file.exists) throw new Error("Secure command record staging file is missing " + path);
  file.encoding = "UTF-8";
  if (!file.open("w")) throw new Error("Cannot write " + path);
  file.write(stringifyJson(value));
  file.close();
  var target = new File(path);
  if (target.exists) throw new Error("Refusing to replace existing command record " + path);
  if (!file.rename(target.name)) throw new Error("Cannot publish " + path);
}

var DOCUMENT_KEY_SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function documentKeyUtf8Bytes(text) {
  var bytes = [];
  for (var index = 0; index < text.length; index++) {
    var code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
      var low = text.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
        index++;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xC0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

function documentKeyRotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function documentKeySha256Hex(text) {
  var bytes = documentKeyUtf8Bytes(text);
  var bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var lengthHigh = Math.floor(bitLength / 4294967296);
  var lengthLow = bitLength % 4294967296;
  bytes.push((lengthHigh >>> 24) & 255, (lengthHigh >>> 16) & 255, (lengthHigh >>> 8) & 255, lengthHigh & 255);
  bytes.push((lengthLow >>> 24) & 255, (lengthLow >>> 16) & 255, (lengthLow >>> 8) & 255, lengthLow & 255);
  var state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var words = [];
  for (var offset = 0; offset < bytes.length; offset += 64) {
    var round;
    for (round = 0; round < 16; round++) {
      var wordOffset = offset + round * 4;
      words[round] = ((bytes[wordOffset] << 24) | (bytes[wordOffset + 1] << 16) |
        (bytes[wordOffset + 2] << 8) | bytes[wordOffset + 3]) >>> 0;
    }
    for (round = 16; round < 64; round++) {
      var sigma0 = documentKeyRotr(words[round - 15], 7) ^ documentKeyRotr(words[round - 15], 18) ^ (words[round - 15] >>> 3);
      var sigma1 = documentKeyRotr(words[round - 2], 17) ^ documentKeyRotr(words[round - 2], 19) ^ (words[round - 2] >>> 10);
      words[round] = (words[round - 16] + sigma0 + words[round - 7] + sigma1) >>> 0;
    }
    var a = state[0], b = state[1], c = state[2], d = state[3];
    var e = state[4], f = state[5], g = state[6], h = state[7];
    for (round = 0; round < 64; round++) {
      var bigSigma1 = documentKeyRotr(e, 6) ^ documentKeyRotr(e, 11) ^ documentKeyRotr(e, 25);
      var choose = (e & f) ^ (~e & g);
      var temp1 = (h + bigSigma1 + choose + DOCUMENT_KEY_SHA256_K[round] + words[round]) >>> 0;
      var bigSigma0 = documentKeyRotr(a, 2) ^ documentKeyRotr(a, 13) ^ documentKeyRotr(a, 22);
      var majority = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (bigSigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  var hex = "";
  var digits = "0123456789abcdef";
  for (var stateIndex = 0; stateIndex < 8; stateIndex++) {
    for (var shift = 28; shift >= 0; shift -= 4) hex += digits.charAt((state[stateIndex] >>> shift) & 15);
  }
  return hex;
}

function documentKeyShort(fullKey) {
  return documentKeySha256Hex(fullKey).substring(0, 16);
}

function isShortDocumentKey(value) {
  if (typeof value !== "string" || value.length !== 16) return false;
  for (var index = 0; index < 16; index++) {
    if ("0123456789abcdef".indexOf(value.charAt(index)) < 0) return false;
  }
  return true;
}

function readDocumentPath(doc) {
  try {
    var fsName = doc.fullName.fsName;
    if (typeof fsName !== "string" || fsName.length === 0) return { available: false, path: "" };
    return { available: true, path: fsName };
  } catch (_error) {
    return { available: false, path: "" };
  }
}

function getDocumentIdentity(doc, documentIndex) {
  var fullPath = readDocumentPath(doc).path;
  var name = doc.name;
  var fileRevision = null;
  var fileExists = null;
  if (fullPath) {
    try {
      var sourceFile = new File(fullPath);
      var existsValue = sourceFile.exists;
      if (typeof existsValue === "boolean") fileExists = existsValue;
      if (fileExists !== false) {
        fileRevision = String(sourceFile.length) + ":" + String(sourceFile.modified.getTime());
      }
    } catch (_revisionError) {}
  }
  var artboardParts = [];
  for (var artboardCursor = 0; artboardCursor < doc.artboards.length; artboardCursor++) {
    var artboardRect = doc.artboards[artboardCursor].artboardRect;
    artboardParts.push([artboardRect[0], artboardRect[1], artboardRect[2], artboardRect[3]].join(","));
  }
  var saved = doc.saved === true;
  var key = "v1|path=" + encodeURIComponent(fullPath) + "|name=" + encodeURIComponent(name) +
    "|index=" + documentIndex + "|saved=" + saved + "|revision=" + encodeURIComponent(fileRevision || "") +
    "|artboards=" + encodeURIComponent(artboardParts.join(";"));
  var colorSpace = "unknown";
  if (doc.documentColorSpace === DocumentColorSpace.RGB) colorSpace = "RGB";
  if (doc.documentColorSpace === DocumentColorSpace.CMYK) colorSpace = "CMYK";
  return {
    keyVersion: 1,
    key: key,
    keyShort: documentKeyShort(key),
    name: name,
    path: fullPath || null,
    fileRevision: fileRevision,
    fileExists: fileExists,
    saved: saved,
    colorSpace: colorSpace
  };
}

/**
 * the open edit session (if any) the Node side handed to this host call for a document path. The
 * wrapper declares EDIT_SESSION_ADMISSION_INPUT only for commands that take part in edit sessions.
 */
function editSessionForPath(path) {
  if (typeof EDIT_SESSION_ADMISSION_INPUT === "undefined" || EDIT_SESSION_ADMISSION_INPUT === null || !path) return null;
  var sessions = EDIT_SESSION_ADMISSION_INPUT.sessions;
  for (var sessionIndex = 0; sessionIndex < sessions.length; sessionIndex++) {
    if (sessions[sessionIndex].sourcePath === path) return sessions[sessionIndex];
  }
  return null;
}

function getDocumentContext() {
  if (app.documents.length === 0) throw new Error("No Illustrator document is open.");
  var doc = app.activeDocument;
  var documentIndex = -1;
  for (var documentCursor = 0; documentCursor < app.documents.length; documentCursor++) {
    if (app.documents[documentCursor] === doc) { documentIndex = documentCursor; break; }
  }
  var identity = getDocumentIdentity(doc, documentIndex);
  var pathState = readDocumentPath(doc);
  var mutationProfile = null;
  var mutationBlockedReason = null;
  if (!pathState.available) mutationBlockedReason = "The document path could not be read (path_unavailable); mutation is refused.";
  else if (identity.fileExists === false) mutationProfile = "unsaved_document";
  else if (!identity.saved) mutationBlockedReason = "Save pending document changes before mutation.";
  else if (!identity.fileRevision) mutationBlockedReason = "The saved file revision could not be verified.";
  else mutationProfile = "saved_file";
  if (pathState.available && identity.fileExists !== false) {
    var editSession = editSessionForPath(identity.path);
    // Tentative: requireDocument confirms the structure digest before any change is admitted.
    if (editSession !== null && identity.fileRevision !== null && identity.fileRevision === editSession.sourceFileRevision) {
      mutationProfile = "edit_session_file";
      mutationBlockedReason = null;
    }
  }
  return {
    keyVersion: identity.keyVersion,
    key: identity.key,
    keyShort: identity.keyShort,
    name: identity.name,
    path: identity.path,
    fileRevision: identity.fileRevision,
    saved: identity.saved,
    colorSpace: identity.colorSpace,
    activeArtboardIndex: doc.artboards.getActiveArtboardIndex(),
    activeArtboardBounds: (function () {
      var activeRect = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
      return [activeRect[0], activeRect[1], activeRect[2], activeRect[3]];
    })(),
    artboardCount: doc.artboards.length,
    appVersion: app.version,
    mutationProfile: mutationProfile,
    mutationAllowed: mutationProfile !== null,
    mutationBlockedReason: mutationBlockedReason
  };
}

function documentKeyMatchesContext(expectedKey, context) {
  if (isShortDocumentKey(expectedKey)) return context.keyShort === expectedKey;
  return context.key === expectedKey;
}

function assertShortDocumentKeyUnambiguous(expectedKey) {
  if (!isShortDocumentKey(expectedKey)) return;
  var candidates = [];
  for (var documentCursor = 0; documentCursor < app.documents.length; documentCursor++) {
    var identity = getDocumentIdentity(app.documents[documentCursor], documentCursor);
    if (identity.keyShort === expectedKey) candidates.push(identity.key);
  }
  if (candidates.length > 1) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "DOCUMENT_KEY_AMBIGUOUS", expected: expectedKey, candidates: candidates }));
  }
}

function resolveExpectedDocument(expectedKey) {
  var context = getDocumentContext();
  assertShortDocumentKeyUnambiguous(expectedKey);
  if (!documentKeyMatchesContext(expectedKey, context)) {
    throw new Error("MCP_ERROR:" + stringifyJson({
      code: "DOCUMENT_MISMATCH", expected: expectedKey, actual: context.key, actualShort: context.keyShort
    }));
  }
  return context;
}

function requireDocument(expectedKey) {
  var context = resolveExpectedDocument(expectedKey);
  var editSession = editSessionForPath(context.path);
  if (editSession !== null) {
    // Only the transaction runner can bind a change to the session head; any other script is refused before a change.
    if (typeof mutationEditSessionAdmit !== "function") {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "EDIT_SESSION_OPERATION_UNSUPPORTED", sessionId: editSession.sessionId }));
    }
    return mutationEditSessionAdmit(context, editSession);
  }
  if (!context.mutationAllowed) throw new Error("MCP_ERROR:" + stringifyJson({ code: "DOCUMENT_NOT_SAVED", message: context.mutationBlockedReason }));
  return context;
}

function requireDocumentForRead(expectedKey) {
  return resolveExpectedDocument(expectedKey);
}
`;
export function buildJsxCommand(options) {
    return `(function () {\n${JSX_RUNTIME}\n` +
        (options.editSessionAdmission === undefined ? '' :
            `var EDIT_SESSION_ADMISSION_INPUT = ${JSON.stringify(options.editSessionAdmission)};\n`) +
        `var COMMAND_ID = ${JSON.stringify(options.commandId)};\n` +
        `var PARAMS_PATH = ${JSON.stringify(options.paramsPath)};\n` +
        `var RESULT_PATH = ${JSON.stringify(options.resultPath)};\n` +
        `var STATUS_PATH = ${JSON.stringify(options.statusPath)};\n` +
        `function recordMutationAuditEvent(event) {\n` +
        `var sequenceName = String(event.sequence);\n` +
        `while (sequenceName.length < 3) sequenceName = "0" + sequenceName;\n` +
        `writeJsonNew(STATUS_PATH + ".audit." + sequenceName + ".json", event);\n` +
        `}\n` +
        `function mutationResultEnvelope(envelope) {\n` +
        `if (typeof MUTATION_EDIT_SESSION_EVIDENCE !== "undefined" && MUTATION_EDIT_SESSION_EVIDENCE !== null) envelope.editSession = MUTATION_EDIT_SESSION_EVIDENCE;\n` +
        `return envelope;\n` +
        `}\n` +
        `writeJsonNew(STATUS_PATH + ".running.json", { commandId: COMMAND_ID, state: "running" });\n` +
        `var operationError = null;\n` +
        `try {\nvar params = readJson(PARAMS_PATH);\n${options.script}\n` +
        `} catch (error) {\n` +
        `operationError = error && error.message ? error.message : String(error);\n` +
        `}\n` +
        `if (operationError === null) {\n` +
        `if (typeof MUTATION_RUNNER_DISPOSITION !== "undefined" && MUTATION_RUNNER_DISPOSITION === "indeterminate") {\n` +
        `writeJsonNew(RESULT_PATH, mutationResultEnvelope({ commandId: COMMAND_ID, state: "indeterminate", data: result }));\n` +
        `} else {\n` +
        `writeJsonNew(RESULT_PATH, mutationResultEnvelope({ commandId: COMMAND_ID, state: "completed", data: result }));\n` +
        `writeJsonNew(STATUS_PATH + ${JSON.stringify(options.mutation === true ? '.host_completed.json' : '.completed.json')}, ` +
        `{ commandId: COMMAND_ID, state: ${JSON.stringify(options.mutation === true ? 'host_completed' : 'completed')} });\n` +
        `}\n` +
        `} else if ((typeof MUTATION_SIDE_EFFECT_ATTEMPTED !== "undefined" && MUTATION_SIDE_EFFECT_ATTEMPTED === true) || ` +
        `(typeof MUTATION_FORCE_INDETERMINATE !== "undefined" && MUTATION_FORCE_INDETERMINATE === true)) {\n` +
        `writeJsonNew(RESULT_PATH, mutationResultEnvelope({ commandId: COMMAND_ID, state: "indeterminate", message: "Mutation ended after the side-effect attempt boundary." }));\n` +
        `} else {\n` +
        (options.mutation === true ? '' :
            `writeJsonNew(RESULT_PATH, { commandId: COMMAND_ID, state: "failed", message: operationError });\n`) +
        `writeJsonNew(STATUS_PATH + ".failed.json", { commandId: COMMAND_ID, state: "failed", message: operationError });\n` +
        `}\n})();`;
}
