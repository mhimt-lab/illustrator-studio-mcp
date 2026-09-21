import { z } from 'zod';
import { PLAIN_POINT_TEXT_V1 } from './adapters/point-text-host-script.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
export const TEXT_STYLE_UNDEFINED_ATTRIBUTE_ERROR = PLAIN_POINT_TEXT_V1.undefinedStyleAttributeErrorNumber;
export const TEXT_STYLE_MAX_STYLES = 256;
export const TEXT_STYLE_MAX_TARGET_CHARACTERS = 256;
export const TEXT_STYLE_MAX_TARGET_PARAGRAPHS = 64;
export const TEXT_STYLE_MAX_NAME_LENGTH = 1_024;
export const TEXT_STYLE_MAX_VALUE_LENGTH = 1_024;
const CHARACTER_FREE_FIELDS = ['textFont', 'size', 'tracking', 'horizontalScale', 'verticalScale',
    'leading', 'fillColor', 'strokeColor'];
const PARAGRAPH_FREE_FIELDS = ['justification'];
function fields(free, pinned) {
    const pinnedOnly = Object.keys(pinned).filter((name) => !free.includes(name)).sort();
    return [...free, ...pinnedOnly];
}
export const TEXT_STYLE_CHARACTER_FIELDS = fields(CHARACTER_FREE_FIELDS, PLAIN_POINT_TEXT_V1.character);
export const TEXT_STYLE_PARAGRAPH_FIELDS = fields(PARAGRAPH_FREE_FIELDS, PLAIN_POINT_TEXT_V1.paragraph);
export const TEXT_STYLE_OBJECT_FIELDS = ['textFont', 'fillColor', 'strokeColor'];
const characterFieldSchema = z.enum(TEXT_STYLE_CHARACTER_FIELDS);
const paragraphFieldSchema = z.enum(TEXT_STYLE_PARAGRAPH_FIELDS);
export const textStyleAttributeReadingSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('defined'), value: z.string().max(TEXT_STYLE_MAX_VALUE_LENGTH) }),
    z.strictObject({ status: z.literal('undefined') }),
    z.strictObject({ status: z.literal('error'), number: z.number().int().nullable() }),
]);
const styleEntryBase = {
    index: z.number().int().nonnegative().max(TEXT_STYLE_MAX_STYLES),
    name: z.string().max(TEXT_STYLE_MAX_NAME_LENGTH),
    duplicateName: z.boolean(),
};
export const characterStyleEntrySchema = z.strictObject({
    ...styleEntryBase,
    kind: z.literal('character'),
    attributes: z.record(characterFieldSchema, textStyleAttributeReadingSchema),
});
export const paragraphStyleEntrySchema = z.strictObject({
    ...styleEntryBase,
    kind: z.literal('paragraph'),
    attributes: z.record(paragraphFieldSchema, textStyleAttributeReadingSchema),
});
const appliedStylesSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('read'), names: z.array(z.string().max(TEXT_STYLE_MAX_NAME_LENGTH)).max(TEXT_STYLE_MAX_STYLES) }),
    z.strictObject({ status: z.literal('error'), number: z.number().int().nullable() }),
]);
const overrideUnavailableReasonSchema = z.enum([
    'applied_style_unreadable',
    'no_single_applied_style',
    'applied_style_not_found',
    'applied_style_name_conflict',
]);
const overridesSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('compared'),
        scope: z.literal('style_defined_fields'),
        styleName: z.string().max(TEXT_STYLE_MAX_NAME_LENGTH),
        styleIndex: z.number().int().nonnegative().max(TEXT_STYLE_MAX_STYLES),
        fields: z.array(z.strictObject({
            field: z.string().max(64),
            styleValue: z.string().max(TEXT_STYLE_MAX_VALUE_LENGTH),
            resolved: textStyleAttributeReadingSchema,
        })).max(TEXT_STYLE_CHARACTER_FIELDS.length + TEXT_STYLE_PARAGRAPH_FIELDS.length),
    }),
    z.strictObject({ status: z.literal('unavailable'), reason: overrideUnavailableReasonSchema }),
]);
const targetUsageSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    kind: z.string().max(64),
    characterCount: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    characters: z.array(z.strictObject({
        index: z.number().int().nonnegative(),
        contents: z.string().max(8),
        attributes: z.record(characterFieldSchema, textStyleAttributeReadingSchema),
        appliedStyles: appliedStylesSchema,
        overrides: overridesSchema,
    })).max(TEXT_STYLE_MAX_TARGET_CHARACTERS),
    paragraphs: z.array(z.strictObject({
        index: z.number().int().nonnegative(),
        attributes: z.record(paragraphFieldSchema, textStyleAttributeReadingSchema),
        appliedStyles: appliedStylesSchema,
        overrides: overridesSchema,
    })).max(TEXT_STYLE_MAX_TARGET_PARAGRAPHS),
}).superRefine((target, context) => {
    if (target.end < target.start || target.end > target.characterCount ||
        target.characters.length !== target.end - target.start) {
        context.addIssue({ code: 'custom', message: 'A text-style target must report exactly the requested character range.' });
    }
    target.characters.forEach((character, offset) => {
        if (character.index !== target.start + offset) {
            context.addIssue({ code: 'custom', message: 'Text-style target characters must be contiguous from start.' });
        }
    });
});
export const textStyleListSchema = z.strictObject({
    document: documentContextSchema,
    complete: z.literal(true),
    characterStyleCount: z.number().int().nonnegative().max(TEXT_STYLE_MAX_STYLES),
    paragraphStyleCount: z.number().int().nonnegative().max(TEXT_STYLE_MAX_STYLES),
    characterStyles: z.array(characterStyleEntrySchema).max(TEXT_STYLE_MAX_STYLES),
    paragraphStyles: z.array(paragraphStyleEntrySchema).max(TEXT_STYLE_MAX_STYLES),
    nameConflicts: z.strictObject({
        character: z.array(z.string().max(TEXT_STYLE_MAX_NAME_LENGTH)).max(TEXT_STYLE_MAX_STYLES),
        paragraph: z.array(z.string().max(TEXT_STYLE_MAX_NAME_LENGTH)).max(TEXT_STYLE_MAX_STYLES),
    }),
    target: targetUsageSchema.nullable(),
}).superRefine((value, context) => {
    if (value.characterStyleCount !== value.characterStyles.length ||
        value.paragraphStyleCount !== value.paragraphStyles.length) {
        context.addIssue({ code: 'custom', message: 'Text-style counts must equal the reported style collections.' });
    }
    for (const entries of [value.characterStyles, value.paragraphStyles]) {
        entries.forEach((entry, index) => {
            if (entry.index !== index) {
                context.addIssue({ code: 'custom', message: 'Text styles must be reported in collection order.' });
            }
        });
    }
});
export const TEXT_STYLE_RESOURCE_SCRIPT = `
var TEXT_STYLE_UNDEFINED_ATTRIBUTE_ERROR = ${TEXT_STYLE_UNDEFINED_ATTRIBUTE_ERROR};
var TEXT_STYLE_MAX_STYLES = ${TEXT_STYLE_MAX_STYLES};
var TEXT_STYLE_MAX_VALUE_LENGTH = ${TEXT_STYLE_MAX_VALUE_LENGTH};
var TEXT_STYLE_FIELDS = ${JSON.stringify({
    character: TEXT_STYLE_CHARACTER_FIELDS, paragraph: TEXT_STYLE_PARAGRAPH_FIELDS,
})};
var TEXT_STYLE_OBJECT_FIELDS = ${JSON.stringify(Object.fromEntries(TEXT_STYLE_OBJECT_FIELDS.map((name) => [name, true])))};

function textStyleErrorNumber(error) {
  return error && typeof error.number === "number" ? Number(error.number) : null;
}

function textStyleTruncate(value) {
  var text = String(value);
  if (text.length <= TEXT_STYLE_MAX_VALUE_LENGTH) return text;
  var truncated = text.substring(0, TEXT_STYLE_MAX_VALUE_LENGTH);
  var lastCode = truncated.charCodeAt(truncated.length - 1);
  if (lastCode >= 0xD800 && lastCode <= 0xDBFF) truncated = truncated.substring(0, truncated.length - 1);
  return truncated;
}

/** The canonical encoding of PLAIN_POINT_TEXT_V1, extended with the paint and font forms. */
function textStyleCanonicalValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  var type = typeof value;
  if (type === "number") return isFinite(value) ? String(value) : "nonfinite";
  if (type === "boolean") return value ? "true" : "false";
  if (type === "string") return "s:" + value;
  if (type === "function") return "function";
  var typename = null;
  try { typename = String(value.typename); } catch (typenameError) { typename = null; }
  if (typename === "TextFont") return "font:" + String(value.name);
  if (typename === "RGBColor") return "rgb:" + value.red + "," + value.green + "," + value.blue;
  if (typename === "CMYKColor") return "cmyk:" + value.cyan + "," + value.magenta + "," + value.yellow + "," + value.black;
  if (typename === "GrayColor") return "gray:" + value.gray;
  if (typename === "NoColor") return "none";
  if (typename !== null && typename.length > 0 && typename !== "undefined") return "color:" + typename;
  return "o:" + String(value);
}

/**
 * One attribute of a style resource or a text range. Error 9563 means the style does not define the
 * attribute; an object-valued attribute reads as null in the same case (both measured on textFont).
 */
function textStyleReading(host, name) {
  var value;
  try { value = host[name]; }
  catch (readError) {
    var number = textStyleErrorNumber(readError);
    if (number === TEXT_STYLE_UNDEFINED_ATTRIBUTE_ERROR) return { status: "undefined" };
    return { status: "error", number: number };
  }
  if ((value === null || value === undefined) && TEXT_STYLE_OBJECT_FIELDS[name] === true) {
    return { status: "undefined" };
  }
  return { status: "defined", value: textStyleTruncate(textStyleCanonicalValue(value)) };
}

function textStyleReadings(host, kind) {
  var names = TEXT_STYLE_FIELDS[kind];
  var readings = {};
  for (var index = 0; index < names.length; index++) readings[names[index]] = textStyleReading(host, names[index]);
  return readings;
}

function textStyleAttributesOf(style, kind) {
  var attributes;
  try { attributes = kind === "character" ? style.characterAttributes : style.paragraphAttributes; }
  catch (attributesError) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "TEXT_STYLE_UNREADABLE", kind: kind }));
  }
  if (!attributes) throw new Error("MCP_ERROR:" + stringifyJson({ code: "TEXT_STYLE_UNREADABLE", kind: kind }));
  return attributes;
}

function textStyleCollection(document, kind) {
  var collection = kind === "character" ? document.characterStyles : document.paragraphStyles;
  if (!collection || typeof collection.length !== "number") {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "TEXT_STYLE_UNREADABLE", kind: kind }));
  }
  if (collection.length > TEXT_STYLE_MAX_STYLES) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "TEXT_STYLE_LIMIT", kind: kind,
      total: collection.length, limit: TEXT_STYLE_MAX_STYLES }));
  }
  return collection;
}

function textStyleNames(collection) {
  var names = [];
  for (var index = 0; index < collection.length; index++) {
    var name;
    try { name = String(collection[index].name); }
    catch (nameError) {
      throw new Error("MCP_ERROR:" + stringifyJson({ code: "TEXT_STYLE_NAME_UNREADABLE", total: index }));
    }
    names.push(name);
  }
  return names;
}

function textStyleNameCount(names, name) {
  var count = 0;
  for (var index = 0; index < names.length; index++) if (names[index] === name) count++;
  return count;
}

function textStyleEntry(collection, names, index, kind) {
  return { kind: kind, index: index, name: names[index],
    duplicateName: textStyleNameCount(names, names[index]) > 1,
    attributes: textStyleReadings(textStyleAttributesOf(collection[index], kind), kind) };
}

function textStyleEntries(document, kind) {
  var collection = textStyleCollection(document, kind);
  var names = textStyleNames(collection);
  var entries = [];
  for (var index = 0; index < collection.length; index++) entries.push(textStyleEntry(collection, names, index, kind));
  return entries;
}

function textStyleConflicts(entries) {
  var conflicts = [];
  for (var index = 0; index < entries.length; index++) {
    if (!entries[index].duplicateName) continue;
    var seen = false;
    for (var seenIndex = 0; seenIndex < conflicts.length; seenIndex++) {
      if (conflicts[seenIndex] === entries[index].name) seen = true;
    }
    if (!seen) conflicts.push(entries[index].name);
  }
  return conflicts;
}

/**
 * Resolve one style by exact name. Zero matches and more than one match are both refusals, never a
 * silent pick: applying "the first style called X" is exactly the mistake the style binding contract forbids.
 */
function textStyleResolveNamed(document, kind, name) {
  var collection = textStyleCollection(document, kind);
  var names = textStyleNames(collection);
  var matches = [];
  for (var index = 0; index < names.length; index++) if (names[index] === name) matches.push(index);
  if (matches.length === 0) {
    return { status: "missing", code: "TEXT_STYLE_NOT_FOUND", kind: kind, name: name, count: 0 };
  }
  if (matches.length > 1) {
    return { status: "conflict", code: "TEXT_STYLE_NAME_CONFLICT", kind: kind, name: name, count: matches.length };
  }
  return { status: "resolved", style: collection[matches[0]],
    entry: textStyleEntry(collection, names, matches[0], kind) };
}
`;
export const LIST_TEXT_STYLES_SCRIPT = `${TEXT_STYLE_RESOURCE_SCRIPT}
var TEXT_STYLE_MAX_TARGET_CHARACTERS = ${TEXT_STYLE_MAX_TARGET_CHARACTERS};
var TEXT_STYLE_MAX_TARGET_PARAGRAPHS = ${TEXT_STYLE_MAX_TARGET_PARAGRAPHS};

function textStyleTargetError(code, detail) {
  var payload = { code: code };
  for (var key in detail) if (detail.hasOwnProperty(key)) payload[key] = detail[key];
  return new Error("MCP_ERROR:" + stringifyJson(payload));
}

function textStyleFindTarget(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") {
    throw textStyleTargetError("TEXT_STYLE_UUID_LOOKUP_UNAVAILABLE", {});
  }
  var target = null;
  try { target = document.getPageItemFromUuid(uuid); }
  catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (!(lookupError && Number(lookupError.number) === 1200 &&
        message === "an Illustrator error occurred: 1346458189 ('MRAP')")) throw lookupError;
    target = null;
  }
  if (target === null || target === undefined) throw textStyleTargetError("OBJECT_NOT_FOUND", { uuid: uuid });
  if (String(target.typename) !== "TextFrame") {
    throw textStyleTargetError("TEXT_STYLE_TARGET_UNSUPPORTED", { uuid: uuid, type: String(target.typename) });
  }
  return target;
}

/**
 * Which named styles a range reports. Unmeasured, so a failed read is recorded as data instead of
 * failing the whole call.
 */
function textStyleApplied(range, kind) {
  try {
    var collection = kind === "character" ? range.characterStyles : range.paragraphStyles;
    if (!collection || typeof collection.length !== "number") return { status: "error", number: null };
    var names = [];
    for (var index = 0; index < collection.length && index < TEXT_STYLE_MAX_STYLES; index++) {
      names.push(String(collection[index].name));
    }
    return { status: "read", names: names };
  } catch (appliedError) { return { status: "error", number: textStyleErrorNumber(appliedError) }; }
}

/** The override difference, comparable only for the fields the applied style actually defines. */
function textStyleOverrides(applied, resolved, entries, kind) {
  if (applied.status !== "read") return { status: "unavailable", reason: "applied_style_unreadable" };
  if (applied.names.length !== 1) return { status: "unavailable", reason: "no_single_applied_style" };
  var matches = [];
  for (var index = 0; index < entries.length; index++) if (entries[index].name === applied.names[0]) matches.push(entries[index]);
  if (matches.length === 0) return { status: "unavailable", reason: "applied_style_not_found" };
  if (matches.length > 1) return { status: "unavailable", reason: "applied_style_name_conflict" };
  var entry = matches[0];
  var names = TEXT_STYLE_FIELDS[kind];
  var differences = [];
  for (var fieldIndex = 0; fieldIndex < names.length; fieldIndex++) {
    var field = names[fieldIndex];
    var styleReading = entry.attributes[field];
    if (!styleReading || styleReading.status !== "defined") continue;
    var resolvedReading = resolved[field];
    if (resolvedReading && resolvedReading.status === "defined" && resolvedReading.value === styleReading.value) continue;
    differences.push({ field: field, styleValue: styleReading.value, resolved: resolvedReading });
  }
  return { status: "compared", scope: "style_defined_fields", styleName: entry.name,
    styleIndex: entry.index, fields: differences };
}

function textStyleTargetUsage(document, request, characterEntries, paragraphEntries) {
  var target = textStyleFindTarget(document, request.uuid);
  var characters = target.characters;
  if (!characters || typeof characters.length !== "number") {
    throw textStyleTargetError("TEXT_STYLE_TARGET_UNREADABLE", { uuid: request.uuid });
  }
  var characterCount = Number(characters.length);
  var start = request.start === undefined || request.start === null ? 0 : Number(request.start);
  var end = request.end === undefined || request.end === null ? characterCount : Number(request.end);
  if (start < 0 || end > characterCount || start > end) {
    throw textStyleTargetError("TEXT_STYLE_RANGE_INVALID",
      { uuid: request.uuid, start: start, end: end, total: characterCount });
  }
  if (end - start > TEXT_STYLE_MAX_TARGET_CHARACTERS) {
    throw textStyleTargetError("TEXT_STYLE_RANGE_LIMIT",
      { uuid: request.uuid, total: end - start, limit: TEXT_STYLE_MAX_TARGET_CHARACTERS });
  }
  var usage = { uuid: String(target.uuid), kind: String(target.kind), characterCount: characterCount,
    start: start, end: end, characters: [], paragraphs: [] };
  for (var index = start; index < end; index++) {
    var character = characters[index];
    var characterReadings = textStyleReadings(character.characterAttributes, "character");
    var characterApplied = textStyleApplied(character, "character");
    usage.characters.push({ index: index, contents: String(character.contents),
      attributes: characterReadings, appliedStyles: characterApplied,
      overrides: textStyleOverrides(characterApplied, characterReadings, characterEntries, "character") });
  }
  var paragraphs = target.paragraphs;
  if (!paragraphs || typeof paragraphs.length !== "number") {
    throw textStyleTargetError("TEXT_STYLE_TARGET_UNREADABLE", { uuid: request.uuid });
  }
  if (paragraphs.length > TEXT_STYLE_MAX_TARGET_PARAGRAPHS) {
    throw textStyleTargetError("TEXT_STYLE_PARAGRAPH_LIMIT",
      { uuid: request.uuid, total: Number(paragraphs.length), limit: TEXT_STYLE_MAX_TARGET_PARAGRAPHS });
  }
  for (var paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    var paragraph = paragraphs[paragraphIndex];
    var paragraphReadings = textStyleReadings(paragraph.paragraphAttributes, "paragraph");
    var paragraphApplied = textStyleApplied(paragraph, "paragraph");
    usage.paragraphs.push({ index: paragraphIndex, attributes: paragraphReadings,
      appliedStyles: paragraphApplied,
      overrides: textStyleOverrides(paragraphApplied, paragraphReadings, paragraphEntries, "paragraph") });
  }
  return usage;
}

var textStyleContext = requireDocumentForRead(params.expectedDocumentKey);
var textStyleDocument = app.activeDocument;
var textStyleCharacterEntries = textStyleEntries(textStyleDocument, "character");
var textStyleParagraphEntries = textStyleEntries(textStyleDocument, "paragraph");
var result = {
  document: textStyleContext,
  complete: true,
  characterStyleCount: textStyleCharacterEntries.length,
  paragraphStyleCount: textStyleParagraphEntries.length,
  characterStyles: textStyleCharacterEntries,
  paragraphStyles: textStyleParagraphEntries,
  nameConflicts: { character: textStyleConflicts(textStyleCharacterEntries),
    paragraph: textStyleConflicts(textStyleParagraphEntries) },
  target: params.target === undefined || params.target === null
    ? null
    : textStyleTargetUsage(textStyleDocument, params.target, textStyleCharacterEntries, textStyleParagraphEntries)
};
`;
