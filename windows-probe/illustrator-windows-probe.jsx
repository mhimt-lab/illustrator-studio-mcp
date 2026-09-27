// illustrator-studio-mcp Windows verification kit: JSX (see README.md next to this file). ExtendScript (ES3).
// windows-probe/illustrator-windows-probe.mjs writes a per-call copy that starts with three generated lines:
//   var MCP_PROBE_ACTION = "read" | "throw-caught" | "throw-uncaught" | "busy" | "rectangle";
//   var MCP_PROBE_RESULT = "<result file path>";
//   var MCP_PROBE_BUSY_MS = <milliseconds>;
// Only documents whose name starts with "mcp-windows-probe" are read or changed; others are only counted.
var MCP_PROBE_PREFIX = "mcp-windows-probe";

function mcpQuote(value) {
  var text = String(value);
  var out = "\"";
  for (var index = 0; index < text.length; index += 1) {
    var character = text.charAt(index);
    var code = text.charCodeAt(index);
    if (character === "\"" || character === "\\") out += "\\" + character;
    else if (code < 0x20) out += "\\u" + ("0000" + code.toString(16)).slice(-4);
    else out += character;
  }
  return out + "\"";
}

function mcpWriteResult(json) {
  var file = new File(MCP_PROBE_RESULT);
  file.encoding = "UTF-8";
  if (!file.open("w")) throw new Error("MCP_PROBE_RESULT_OPEN_FAILED");
  file.write(json);
  file.close();
}

function mcpIsDisposable(document) {
  return String(document.name).indexOf(MCP_PROBE_PREFIX) === 0;
}

function mcpDisposableDocuments() {
  var found = [];
  for (var index = 0; index < app.documents.length; index += 1) {
    if (mcpIsDisposable(app.documents[index])) found.push(app.documents[index]);
  }
  return found;
}

function mcpRead() {
  var documents = mcpDisposableDocuments();
  var entries = [];
  for (var index = 0; index < documents.length; index += 1) {
    var document = documents[index];
    var key = null;
    var modified = null;
    try {
      key = encodeURIComponent(document.fullName.fsName);
      modified = new File(document.fullName.fsName).modified.getTime();
    } catch (_unsaved) {
      key = null;
    }
    entries.push("{\"name\":" + mcpQuote(document.name) + ",\"key\":" + (key === null ? "null" : mcpQuote(key)) +
      ",\"modified\":" + (modified === null ? "null" : String(modified)) + "}");
  }
  // File.rename onto an existing name, inside the probe's own state directory.
  var folder = new File(MCP_PROBE_RESULT).parent;
  var source = new File(folder.fsName + "/rename-source.txt");
  var target = new File(folder.fsName + "/rename-target.txt");
  source.open("w"); source.write("source"); source.close();
  target.open("w"); target.write("target"); target.close();
  var renamed = source.rename("rename-target.txt");
  target.open("r");
  var targetText = target.read();
  target.close();
  mcpWriteResult("{\"status\":\"ok\",\"documentCount\":" + app.documents.length + ",\"disposable\":[" + entries.join(",") +
    "],\"renameOntoExisting\":{\"returned\":" + (renamed ? "true" : "false") + ",\"targetText\":" + mcpQuote(targetText) + "}}");
}

function mcpBusy() {
  var until = new Date().getTime() + MCP_PROBE_BUSY_MS;
  var spins = 0;
  while (new Date().getTime() < until) spins += 1;
  mcpWriteResult("{\"status\":\"ok\",\"spins\":" + spins + "}");
}

function mcpRectangle() {
  var document = app.activeDocument;
  if (!mcpIsDisposable(document)) {
    mcpWriteResult("{\"status\":\"refused\",\"reason\":\"active document is not a disposable probe document\"}");
    return;
  }
  var before = document.pageItems.length;
  var rectangle = document.pathItems.rectangle(-10, 10, 20, 20);
  rectangle.name = "mcp-windows-probe-w7";
  mcpWriteResult("{\"status\":\"ok\",\"itemsBefore\":" + before + ",\"itemsAfter\":" + document.pageItems.length + "}");
}

var mcpInteraction = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
try {
  if (MCP_PROBE_ACTION === "read") mcpRead();
  else if (MCP_PROBE_ACTION === "busy") mcpBusy();
  else if (MCP_PROBE_ACTION === "rectangle") mcpRectangle();
  else if (MCP_PROBE_ACTION === "throw-caught") {
    try {
      throw new Error("MCP_PROBE_THROW");
    } catch (error) {
      mcpWriteResult("{\"status\":\"failed\",\"message\":" + mcpQuote(error.message) + "}");
    }
  } else if (MCP_PROBE_ACTION === "throw-uncaught") {
    throw new Error("MCP_PROBE_THROW");
  } else {
    mcpWriteResult("{\"status\":\"refused\",\"reason\":\"unknown action\"}");
  }
} finally {
  app.userInteractionLevel = mcpInteraction;
}
