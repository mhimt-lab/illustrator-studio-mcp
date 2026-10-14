import { z } from 'zod';
export const FONT_LOOKUP_MAX_NAMES = 32;
export const fontPostScriptNameSchema = z.string().min(1).max(255);
export const fontDescriptorSchema = z.strictObject({
    postScriptName: fontPostScriptNameSchema,
    family: z.string().max(255),
    style: z.string().max(255),
});
export const fontLookupEntrySchema = z.discriminatedUnion('status', [
    z.strictObject({ requested: fontPostScriptNameSchema, status: z.literal('installed'), font: fontDescriptorSchema }),
    z.strictObject({
        requested: fontPostScriptNameSchema,
        status: z.literal('not_installed'),
        reason: z.enum(['no_such_font', 'name_mismatch']),
    }),
    z.strictObject({
        requested: fontPostScriptNameSchema,
        status: z.literal('unverified'),
        font: fontDescriptorSchema,
        reason: z.literal('not_found_outside_illustrator'),
    }),
]).superRefine((entry, context) => {
    if (entry.status !== 'not_installed' && entry.font.postScriptName !== entry.requested) {
        context.addIssue({ code: 'custom', message: 'An installed font must carry exactly the requested PostScript name.' });
    }
});
export const fontLookupResultSchema = z.strictObject({
    complete: z.literal(true),
    fonts: z.array(fontLookupEntrySchema).min(1).max(FONT_LOOKUP_MAX_NAMES),
});
export const fontLookupInputSchema = z.array(fontPostScriptNameSchema).min(1).max(FONT_LOOKUP_MAX_NAMES);
export const FONT_LOOKUP_HOST_SCRIPT = `
function fontLookup(name) {
  var font;
  try { font = app.textFonts.getByName(String(name)); }
  catch (lookupError) { return { status: "not_installed", reason: "no_such_font" }; }
  if (font === null || font === undefined) return { status: "not_installed", reason: "no_such_font" };
  if (String(font.name) !== String(name)) return { status: "not_installed", reason: "name_mismatch" };
  return { status: "installed", font: font };
}
function fontExact(name) {
  var found = fontLookup(name);
  return found.status === "installed" ? found.font : null;
}
function fontDescriptor(font) {
  return { postScriptName: String(font.name), family: String(font.family), style: String(font.style) };
}
`;
export const FIND_FONTS_SCRIPT = `${FONT_LOOKUP_HOST_SCRIPT}
var fontEntries = [];
for (var fontIndex = 0; fontIndex < params.postScriptNames.length; fontIndex++) {
  var fontRequested = String(params.postScriptNames[fontIndex]);
  var fontFound = fontLookup(fontRequested);
  fontEntries.push(fontFound.status === "installed"
    ? { requested: fontRequested, status: "installed", font: fontDescriptor(fontFound.font) }
    : { requested: fontRequested, status: "not_installed", reason: fontFound.reason });
}
var result = { complete: true, fonts: fontEntries };
`;
export const FIND_FONTS_QUERY_MAX_LENGTH = 64;
export const FONT_SEARCH_PAGE_SIZE = 50;
export const fontQuerySchema = z.string().min(1).max(FIND_FONTS_QUERY_MAX_LENGTH);
export const fontCursorSchema = z.string().min(1).max(255);
export const fontSearchEntrySchema = z.strictObject({
    postScriptName: fontPostScriptNameSchema,
    family: z.string().max(255),
    style: z.string().max(255),
    status: z.enum(['installed', 'unverified']),
    reason: z.literal('not_found_outside_illustrator').optional(),
}).superRefine((entry, context) => {
    if ((entry.status === 'unverified') !== (entry.reason !== undefined)) {
        context.addIssue({ code: 'custom', message: 'reason is present exactly for an unverified font.' });
    }
});
export const fontSearchResultSchema = z.strictObject({
    complete: z.literal(true),
    matched: z.number().int().nonnegative(),
    fonts: z.array(fontSearchEntrySchema).max(FONT_SEARCH_PAGE_SIZE),
    next_cursor: fontCursorSchema.nullable(),
});
export const fontQueryHostResultSchema = z.strictObject({
    fonts: z.array(fontDescriptorSchema),
    truncated: z.boolean(),
    scanned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
});
export const FIND_FONTS_QUERY_BYTE_LIMIT = 262_144 - 8_192;
export function foldAsciiFontText(text) {
    let folded = '';
    for (const character of text)
        folded += character >= 'A' && character <= 'Z' ? character.toLowerCase() : character;
    return folded;
}
export function fontQueryNeedles(query) {
    return [...new Set([foldAsciiFontText(query.normalize('NFC')), foldAsciiFontText(query.normalize('NFD'))])];
}
export function foldFontText(text) {
    return text.normalize('NFC').replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}
export function selectFontSearchPage(rows, query, cursor, pageSize) {
    const needle = foldFontText(query);
    const byName = new Map();
    for (const row of rows)
        if (!byName.has(row.postScriptName))
            byName.set(row.postScriptName, row);
    const matches = [...byName.values()]
        .filter((font) => [font.postScriptName, font.family, font.style].some((value) => foldFontText(value).includes(needle)))
        .sort((left, right) => (left.postScriptName < right.postScriptName ? -1 : left.postScriptName > right.postScriptName ? 1 : 0));
    const after = cursor === null ? matches : matches.filter((font) => font.postScriptName > cursor);
    const fonts = after.slice(0, pageSize);
    return { matched: matches.length, fonts, nextCursor: after.length > pageSize ? fonts[fonts.length - 1].postScriptName : null };
}
export const FIND_FONTS_QUERY_SCRIPT = `${FONT_LOOKUP_HOST_SCRIPT}
function fontQueryAsciiFold(text) {
  var folded = "";
  for (var charIndex = 0; charIndex < text.length; charIndex++) {
    var code = text.charCodeAt(charIndex);
    folded += (code >= 65 && code <= 90) ? String.fromCharCode(code + 32) : text.charAt(charIndex);
  }
  return folded;
}
function fontQueryMatches(values, needles) {
  for (var needleIndex = 0; needleIndex < needles.length; needleIndex++) {
    for (var valueIndex = 0; valueIndex < values.length; valueIndex++) {
      if (values[valueIndex].indexOf(needles[needleIndex]) !== -1) return true;
    }
  }
  return false;
}
var fontTotal = app.textFonts.length;
var fontRecordBytes = 0;
for (var inventoryIndex = 0; inventoryIndex < fontTotal; inventoryIndex++) {
  fontRecordBytes += jsonFileTextWithBytes(stringifyJson(String(app.textFonts[inventoryIndex].name))).bytes + 1;
}
var fontRows = [];
var fontTruncated = false;
var fontScanned = 0;
for (var fontIndex = 0; fontIndex < fontTotal; fontIndex++) {
  var fontItem = app.textFonts[fontIndex];
  var fontName = String(fontItem.name);
  var fontFamily = String(fontItem.family);
  var fontStyle = String(fontItem.style);
  fontScanned++;
  var fontFolded = [fontQueryAsciiFold(fontName), fontQueryAsciiFold(fontFamily), fontQueryAsciiFold(fontStyle)];
  if (!fontQueryMatches(fontFolded, params.needles)) continue;
  var fontRow = { postScriptName: fontName, family: fontFamily, style: fontStyle };
  var fontRowBytes = jsonFileTextWithBytes(stringifyJson(fontRow)).bytes + 1;
  if (fontRecordBytes + fontRowBytes > params.byteLimit) { fontTruncated = true; break; }
  fontRecordBytes += fontRowBytes;
  fontRows.push(fontRow);
}
var result = { fonts: fontRows, truncated: fontTruncated, scanned: fontScanned, total: fontTotal };
`;
