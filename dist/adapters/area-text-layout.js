import { z } from 'zod';
import { AREA_TEXT_MAX_CODE_UNITS, AREA_TEXT_MAX_LINES } from './area-text-host-script.js';
export const composedAreaLayoutSchema = z.strictObject({
    fit: z.strictObject({
        status: z.literal('fits'),
        visibleCharacterCount: z.number().int().nonnegative(),
        requestedCharacterCount: z.number().int().nonnegative(),
    }),
    lineCount: z.number().int().nonnegative().max(AREA_TEXT_MAX_LINES),
    lines: z.array(z.string().max(AREA_TEXT_MAX_CODE_UNITS + 1)).max(AREA_TEXT_MAX_LINES),
}).superRefine((layout, context) => {
    if (layout.lineCount !== layout.lines.length ||
        layout.lines.reduce((total, line) => total + line.length, 0) > AREA_TEXT_MAX_CODE_UNITS + AREA_TEXT_MAX_LINES) {
        context.addIssue({ code: 'custom', message: 'A no-break line layout must carry exactly its bounded lines.' });
    }
});
export const COMPOSED_AREA_LAYOUT_SCRIPT = `
function composedAreaLayout(target, contents) {
  var fit = areaTextFit(target, contents);
  var lines;
  try { lines = target.lines; } catch (linesError) { return null; }
  if (!lines || typeof lines.length !== "number") return null;
  var count = Number(lines.length);
  if (!isFinite(count) || count < 0 || count > AREA_TEXT_MAX_LINES) return null;
  var strings = [];
  var total = 0;
  for (var index = 0; index < count; index++) {
    var text;
    try { text = String(lines[index].contents); } catch (lineError) { return null; }
    total += text.length;
    if (total > AREA_TEXT_MAX_CODE_UNITS + AREA_TEXT_MAX_LINES) return null;
    strings.push(text);
  }
  if (areaTextStripBreaks(strings.join("")).length !== fit.visibleCharacterCount) return null;
  return {
    fit: { status: fit.status, visibleCharacterCount: fit.visibleCharacterCount, requestedCharacterCount: fit.requestedCharacterCount },
    lineCount: count,
    lines: strings
  };
}

`;
