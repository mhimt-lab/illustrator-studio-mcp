import { z } from 'zod';
import { POINT_TEXT_MAX_CODE_UNITS, pointTextCharacterSchema, pointTextFrameSchema, pointTextRangeGroupSnapshotSchema, } from './point-text-host-script.js';
import { RECORDED_JUSTIFICATIONS, RECORDED_PROFILE_NAME, attributeRecordSchema, recordedStrokeSchema } from './text-recorded-profile.js';
import { layoutBoundsSchema, leadingParagraphSpans, paragraphLeadingEntrySchema, } from './text-leading-type-profile.js';
import { isParagraphBreak, multilineContentsSchema, pointTextParagraphBreakSchema, refineMultilineSnapshot, } from './point-text-multiline.js';
export const TEXT_ALIGNMENTS = ['center', 'roman_baseline'];
export const textAlignmentSchema = z.enum(TEXT_ALIGNMENTS);
export const TEXT_ALIGNMENT_NATIVE = Object.freeze({
    center: 'StyleRunAlignmentType.center',
    roman_baseline: 'StyleRunAlignmentType.ROMANBASELINE',
});
export const pointTextAlignedCharacterSchema = pointTextCharacterSchema.extend({
    alignment: textAlignmentSchema.optional(),
    autoLeading: z.boolean().optional(),
    strokeColor: recordedStrokeSchema,
    tsume: z.number().finite().min(0).max(100).optional(),
});
export const setTextStyleSnapshotSchema = pointTextRangeGroupSnapshotSchema.extend({
    profile: z.enum(['plain_point_text_v2', RECORDED_PROFILE_NAME]),
    manualKerning: z.enum(['none', 'present']),
    tabStopCount: z.number().int().nonnegative(),
    justification: z.enum(RECORDED_JUSTIFICATIONS),
    frame: pointTextFrameSchema.extend({ tagCount: z.number().int().nonnegative() }),
    contents: multilineContentsSchema,
    characters: z.array(z.union([pointTextAlignedCharacterSchema, pointTextParagraphBreakSchema]))
        .min(1).max(POINT_TEXT_MAX_CODE_UNITS),
    paragraphLeading: z.array(paragraphLeadingEntrySchema).min(2).max(32).optional(),
    layoutBounds: layoutBoundsSchema.nullable().optional(),
    attributeRecord: attributeRecordSchema.optional(),
}).superRefine((snapshot, context) => {
    refineMultilineSnapshot(snapshot, context);
    const characters = snapshot.characters.filter((entry) => !isParagraphBreak(entry));
    const aligned = characters.filter((entry) => entry.alignment !== undefined).length;
    if (aligned !== 0 && aligned !== characters.length) {
        context.addIssue({ code: 'custom', message: 'A snapshot must record alignment for every character or for none.' });
    }
    if (aligned !== 0 && snapshot.contents.includes('\r')) {
        context.addIssue({ code: 'custom', message: 'Alignment is recorded for single-line point text only.' });
    }
    const recordedProfile = snapshot.profile === RECORDED_PROFILE_NAME;
    const tsumeRecorded = characters.filter((entry) => entry.tsume !== undefined).length;
    if ((tsumeRecorded !== 0 && tsumeRecorded !== characters.length) || (tsumeRecorded !== 0 && !recordedProfile)) {
        context.addIssue({ code: 'custom', message: 'Tsume is recorded for every character of a recorded-profile snapshot or for none.' });
    }
    const stroked = characters.filter((entry) => entry.strokeColor.model === 'recorded').length;
    if (recordedProfile !== (snapshot.attributeRecord !== undefined)) {
        context.addIssue({ code: 'custom', message: 'An attribute record belongs to the recorded profile snapshot, and only to it.' });
    }
    if (!recordedProfile && (stroked !== 0 || snapshot.manualKerning !== 'none' || snapshot.tabStopCount !== 0 || snapshot.frame.tagCount !== 0)) {
        context.addIssue({ code: 'custom', message: 'Only the recorded profile snapshot may carry a stroke, manual kerning, tab stops or tags.' });
    }
    const leading = snapshot.paragraphLeading !== undefined;
    const autoLeadingRecorded = characters.filter((entry) => entry.autoLeading !== undefined).length;
    if (recordedProfile) {
        if (leading || aligned !== 0 || snapshot.contents.includes('\r') || autoLeadingRecorded !== characters.length || snapshot.layoutBounds === undefined) {
            context.addIssue({ code: 'custom', message: 'A recorded-profile snapshot is single-line, records every character\'s auto leading and the bounds, and no alignment or leading type.' });
        }
    }
    else if (leading) {
        if (snapshot.layoutBounds === undefined || autoLeadingRecorded !== characters.length || aligned !== 0 ||
            !snapshot.contents.includes('\r') ||
            snapshot.paragraphLeading.length !== leadingParagraphSpans(snapshot.contents).length) {
            context.addIssue({ code: 'custom', message: 'A leading-type snapshot must record every paragraph\'s leading type, every character\'s auto leading and the bounds, for multi-paragraph text only.' });
        }
    }
    else if (snapshot.layoutBounds !== undefined || autoLeadingRecorded !== 0) {
        context.addIssue({ code: 'custom', message: 'Auto leading and bounds are recorded only in a leading-type or recorded-profile snapshot.' });
    }
});
export function assertAlignmentAlone(style) {
    if (style.alignment === undefined)
        return;
    if (Object.keys(style).some((key) => key !== 'alignment' && style[key] !== undefined)) {
        throw new Error('A point-text alignment edit must not be combined with other style attributes; request them separately.');
    }
}
export const TEXT_ALIGNMENT_MODULE_SCRIPT = `var STYLE_ALIGNMENT_NATIVE_NAMES = ${JSON.stringify(TEXT_ALIGNMENT_NATIVE)};

/** The pinned character table without alignment, which this path records per character instead of pinning. */
var STYLE_PINNED_CHARACTER_WITHOUT_ALIGNMENT = (function () {
  var table = {};
  for (var name in POINT_TEXT_PINNED.character) {
    if (POINT_TEXT_PINNED.character.hasOwnProperty(name) && name !== "alignment") table[name] = POINT_TEXT_PINNED.character[name];
  }
  return table;
})();

function styleAlignmentPublic(value) {
  var name = String(value);
  for (var key in STYLE_ALIGNMENT_NATIVE_NAMES) {
    if (STYLE_ALIGNMENT_NATIVE_NAMES.hasOwnProperty(key) && STYLE_ALIGNMENT_NATIVE_NAMES[key] === name) return key;
  }
  throw mutationError("preflight_failed", "Point-text alignment is outside the measured center and roman_baseline: " + name + ".");
}

function styleAlignmentNative(publicName) {
  if (publicName === "center") return StyleRunAlignmentType.center;
  if (publicName === "roman_baseline") return StyleRunAlignmentType.ROMANBASELINE;
  throw mutationError("preflight_failed", "Point-text alignment must be center or roman_baseline.");
}

/**
 * Alignment is written only to characters whose applied character style is the standard one (the first of the document's
 * character styles): measured, a custom style that leaves alignment undefined ignores the center write and cannot be undone.
 */
function styleAssertStandardCharacterStyle(character) {
  var names = [];
  var standard;
  try {
    var applied = character.characterStyles;
    for (var index = 0; index < applied.length; index++) names.push(String(applied[index].name));
    standard = String(app.activeDocument.characterStyles[0].name);
  } catch (styleError) {
    throw mutationError("preflight_failed", "alignment_character_style_unreadable: the applied character style cannot be read, so the alignment edit is refused.");
  }
  if (names.length !== 1 || names[0] !== standard) {
    throw mutationError("preflight_failed", "alignment_requires_standard_character_style: alignment edits are admitted only for characters whose applied character style is the standard one.");
  }
}

/** Twin of pointTextCharacterFingerprint with alignment recorded instead of pinned; the held character keeps its handle alive. */
function styleAlignedFingerprint(character) {
  var attributes;
  try { attributes = character.characterAttributes; }
  catch (attributesError) {
    throw mutationError("preflight_failed", "A character's attributes are unavailable.");
  }
  pointTextAssertPinned(attributes, STYLE_PINNED_CHARACTER_WITHOUT_ALIGNMENT, "character attribute");
  var font = attributes.textFont;
  if (!font || typeof font.name !== "string" || !font.name) {
    throw mutationError("preflight_failed", "A character's font identity is unavailable.");
  }
  var located = null;
  try { located = app.textFonts.getByName(font.name); }
  catch (fontError) { located = null; }
  if (located === null || located === undefined || located !== font) {
    throw mutationError("preflight_failed", "A character's font is not installed.");
  }
  var fillColor = pointTextReadFillColor(attributes.fillColor);
  var strokeColor = attributes.strokeColor;
  if (!strokeColor || String(strokeColor.typename) !== "NoColor") {
    throw mutationError("preflight_failed", "Point-text range operations support unstroked characters only.");
  }
  return {
    contents: String(character.contents),
    font: { postScriptName: font.name, family: font.family, style: font.style },
    size: pointTextNumber(attributes.size, "characterAttributes.size"),
    tracking: pointTextNumber(attributes.tracking, "characterAttributes.tracking"),
    horizontalScale: pointTextNumber(attributes.horizontalScale, "characterAttributes.horizontalScale"),
    verticalScale: pointTextNumber(attributes.verticalScale, "characterAttributes.verticalScale"),
    leading: pointTextNumber(attributes.leading, "characterAttributes.leading"),
    fillColor: fillColor,
    strokeColor: { model: "none" },
    alignment: styleAlignmentPublic(attributes.alignment)
  };
}

/** The frame's characters: the shared fingerprints, or, for an alignment request, the same plus each character's alignment. */
function styleCharacters(target) {
  if (params.style.alignment === undefined) return pointTextCharacterFingerprints(target);
  var characters = target.characters;
  if (!characters || typeof characters.length !== "number") {
    throw mutationError("preflight_failed", "Target characters are unavailable.");
  }
  if (characters.length < 1 || characters.length > POINT_TEXT_MAX_CODE_UNITS) {
    throw mutationError("preflight_failed", "Point-text range operations support 1 to " +
      POINT_TEXT_MAX_CODE_UNITS + " UTF-16 code units.");
  }
  var fingerprints = [];
  for (var index = 0; index < characters.length; index++) {
    var character = characters[index];
    var manualKerning;
    try { manualKerning = character.kerning; }
    catch (kerningError) {
      if (!kerningError || Number(kerningError.number) !== 9551) {
        throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
      }
      fingerprints.push(styleAlignedFingerprint(character));
      if (index >= params.start && index < params.end) styleAssertStandardCharacterStyle(character);
      continue;
    }
    if (typeof manualKerning !== "number" || !isFinite(manualKerning)) {
      throw mutationError("preflight_failed", "Point-text manual kerning state is unavailable.");
    }
    throw mutationError("preflight_failed", "Point-text range operations do not support manual pair kerning.");
  }
  return fingerprints;
}

`;
