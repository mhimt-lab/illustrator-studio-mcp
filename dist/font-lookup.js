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
]).superRefine((entry, context) => {
    if (entry.status === 'installed' && entry.font.postScriptName !== entry.requested) {
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
