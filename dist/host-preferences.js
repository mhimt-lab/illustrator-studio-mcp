const NAMES = [
    ['ruler', 'rulerType'], ['stroke', 'strokeUnits'], ['text', 'text/units'], ['asian_text', 'text/asianunits'],
    ['scale_line_weight', 'scaleLineWeight'], ['include_stroke_in_bounds', 'includeStrokeInBounds'], ['transform_patterns', 'transformPatterns'],
    ['numbers_are_points', 'numbersArePoints'], ['corner_policy', 'policyForPreservingCorners'],
];
export const READ_PREFERENCES_JSX = `function readPreferenceSnapshot() {
  var fields = ${JSON.stringify(NAMES.map((entry) => entry[0]))};
  var names = ${JSON.stringify(NAMES.map((entry) => entry[1]))};
  var snapshot = {};
  var index;
  for (index = 0; index < fields.length; index++) snapshot[fields[index]] = null;
  try {
    var preferences = app.preferences;
    if (preferences === undefined || preferences === null) return snapshot;
    var read = function (name) { try { return preferences.getIntegerPreference(name); } catch (readError) { return undefined; } };
    var probeName = "mcp_nonexistent_preference_probe";
    var probeBefore = read(probeName);
    // Fail closed: the host answers a missing name with a stray integer (F0). Any other answer is a shape that was never measured.
    if (typeof probeBefore !== "number" || !isFinite(probeBefore)) return snapshot;
    var values = [];
    for (index = 0; index < names.length; index++) values.push(read(names[index]));
    var probeAfter = read(probeName);
    if (probeBefore !== probeAfter) return snapshot;
    for (index = 0; index < names.length; index++) {
      var value = values[index];
      if (typeof value === "number" && isFinite(value) && Math.floor(value) === value && value !== probeBefore) snapshot[fields[index]] = value;
    }
  } catch (snapshotError) {}
  return snapshot;
}`;
export const CONFIRMED_UNIT_NAMES = Object.freeze({
    0: 'inch',
    1: 'millimeter',
    2: 'point',
    3: 'pica',
    4: 'centimeter',
    5: 'q_h',
    6: 'pixel',
});
export const CONFIRMED_CORNER_SCALES = Object.freeze({ 1: true, 2: false });
const toggle = (value) => (value === 0 ? false : value === 1 ? true : null);
export function normalizeHostPreferences(raw, tables = { units: CONFIRMED_UNIT_NAMES, corners: CONFIRMED_CORNER_SCALES }) {
    if (raw === undefined || raw === null)
        return undefined;
    const unit = (code) => {
        const value = typeof code === 'number' ? code : null;
        return { code: value, name: value === null ? null : (tables.units[value] ?? null) };
    };
    const corner = typeof raw.corner_policy === 'number' ? raw.corner_policy : null;
    return {
        units: { ruler: unit(raw.ruler), stroke: unit(raw.stroke), text: unit(raw.text), asian_text: unit(raw.asian_text) },
        scale_strokes_and_effects: toggle(raw.scale_line_weight),
        use_preview_bounds: toggle(raw.include_stroke_in_bounds),
        scale_patterns: toggle(raw.transform_patterns),
        numbers_are_points: toggle(raw.numbers_are_points),
        corner_policy: { code: corner, scale_corners: corner === null ? null : (tables.corners[corner] ?? null) },
    };
}
