import { z } from 'zod';
import { MUTATION_TRANSACTION_SCRIPT } from './mutation-transaction.js';
import { documentContextSchema } from './mutation-result-schema-core.js';
import { SUPPORTED_PATH_ITEM_MAX_PATH_POINTS } from './adapters/supported-path-item-host-script.js';
export const SCALE_REFERENCE_MAX_REFERENCES = 8;
export const SCALE_REFERENCE_MAX_ACTUAL_MM = 1_000_000;
export const SCALE_REFERENCE_MAX_POINTS = SUPPORTED_PATH_ITEM_MAX_PATH_POINTS;
export const SCALE_REFERENCE_COORDINATE_LIMIT = 32_768;
export const SCALE_REFERENCE_CONSISTENT_SPREAD_PERCENT = 0.05;
export const SCALE_REFERENCE_HINT_TOLERANCE = 0.002;
const PT_PER_MM = 72 / 25.4;
const MM_PER_PT = 25.4 / 72;
const coordinate = z.number().finite().min(-SCALE_REFERENCE_COORDINATE_LIMIT).max(SCALE_REFERENCE_COORDINATE_LIMIT);
const xy = z.tuple([coordinate, coordinate]);
const actualMm = z.number().finite().positive().max(SCALE_REFERENCE_MAX_ACTUAL_MM);
export const scaleReferenceInputSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('path'),
        uuid: z.string().min(1).max(255),
        actual_mm: actualMm,
        measure: z.enum(['length', 'chord']).optional(),
    }),
    z.strictObject({
        kind: z.literal('points'),
        from: xy,
        to: xy,
        actual_mm: actualMm,
    }),
]);
const pointSchema = z.strictObject({ anchor: xy, leftDirection: xy, rightDirection: xy });
export const hostReferencePathSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    closed: z.boolean(),
    points: z.array(pointSchema).min(1).max(SCALE_REFERENCE_MAX_POINTS),
});
export const hostReferenceReadSchema = z.strictObject({
    document: documentContextSchema,
    paths: z.array(hostReferencePathSchema).max(SCALE_REFERENCE_MAX_REFERENCES),
});
const finite = z.number().finite();
export const scaleReferenceRowSchema = z.strictObject({
    index: z.number().int().min(0).max(SCALE_REFERENCE_MAX_REFERENCES - 1),
    kind: z.enum(['path', 'points']),
    uuid: z.string().nullable(),
    measure: z.enum(['length', 'chord', 'points']),
    length_method: z.enum(['straight_exact', 'bezier_numeric', 'chord', 'points']),
    point_count: z.number().int().positive().nullable(),
    closed: z.boolean().nullable(),
    measured_pt: finite.positive(),
    measured_mm_as_read: finite.positive(),
    actual_mm: finite.positive(),
    expected_pt: finite.positive(),
    factor: finite.positive(),
    scale_percent: finite.positive(),
});
export const scaleReferenceWarningSchema = z.enum(['single_reference', 'closed_path_perimeter', 'inconsistent_references']);
export const scaleReferenceHintSchema = z.enum(['mm_read_as_pt', 'pt_read_as_mm', 'none']);
export const measureScaleReferenceResultSchema = z.strictObject({
    document: documentContextSchema,
    references: z.array(scaleReferenceRowSchema).min(1).max(SCALE_REFERENCE_MAX_REFERENCES),
    summary: z.strictObject({
        scale_percent: finite.positive().describe('Median of the references, six decimals. Pass it as scale_percent of a scale.'),
        spread_percent: finite.nonnegative().describe('(max - min) / median of the percentages, in percent.'),
        consistent: z.boolean(),
        hint: scaleReferenceHintSchema,
    }),
    warnings: z.array(scaleReferenceWarningSchema),
});
function gaussLegendre(count) {
    const nodes = [], weights = [];
    for (let i = 0; i < count; i += 1) {
        let x = Math.cos(Math.PI * (i + 0.75) / (count + 0.5));
        let derivative = 1;
        for (let iteration = 0; iteration < 100; iteration += 1) {
            let p0 = 1, p1 = x;
            for (let k = 2; k <= count; k += 1) {
                const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
                p0 = p1;
                p1 = p2;
            }
            derivative = count * (x * p1 - p0) / (x * x - 1);
            const step = p1 / derivative;
            x -= step;
            if (Math.abs(step) < 1e-15)
                break;
        }
        nodes.push(x);
        weights.push(2 / ((1 - x * x) * derivative * derivative));
    }
    return { nodes, weights };
}
const GL = gaussLegendre(16);
function speed(b, t) {
    const u = 1 - t;
    const dx = 3 * (u * u * (b[1][0] - b[0][0]) + 2 * u * t * (b[2][0] - b[1][0]) + t * t * (b[3][0] - b[2][0]));
    const dy = 3 * (u * u * (b[1][1] - b[0][1]) + 2 * u * t * (b[2][1] - b[1][1]) + t * t * (b[3][1] - b[2][1]));
    return Math.hypot(dx, dy);
}
function integrate(b, from, to) {
    const half = (to - from) / 2, mid = (to + from) / 2;
    let sum = 0;
    for (let i = 0; i < GL.nodes.length; i += 1)
        sum += GL.weights[i] * speed(b, mid + half * GL.nodes[i]);
    return sum * half;
}
function adaptive(b, from, to, whole, depth) {
    const mid = (from + to) / 2;
    const left = integrate(b, from, mid), right = integrate(b, mid, to);
    if (depth >= 14 || Math.abs(left + right - whole) <= 1e-10 * (1 + whole))
        return left + right;
    return adaptive(b, from, mid, left, depth + 1) + adaptive(b, mid, to, right, depth + 1);
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
export function bezierLength(b) {
    if (same(b[0], b[1]) && same(b[2], b[3]))
        return { length: Math.hypot(b[3][0] - b[0][0], b[3][1] - b[0][1]), straight: true };
    return { length: adaptive(b, 0, 1, integrate(b, 0, 1), 0), straight: false };
}
export function pathLength(path) {
    const { points } = path;
    const segments = [];
    for (let i = 0; i + 1 < points.length; i += 1)
        segments.push([points[i].anchor, points[i].rightDirection, points[i + 1].leftDirection, points[i + 1].anchor]);
    if (path.closed && points.length > 1)
        segments.push([points[points.length - 1].anchor, points[points.length - 1].rightDirection, points[0].leftDirection, points[0].anchor]);
    let length = 0, straight = true;
    for (const segment of segments) {
        const measured = bezierLength(segment);
        length += measured.length;
        straight = straight && measured.straight;
    }
    return { length, method: straight ? 'straight_exact' : 'bezier_numeric' };
}
export const chordLength = (path) => {
    const first = path.points[0].anchor, last = path.points[path.points.length - 1].anchor;
    return Math.hypot(last[0] - first[0], last[1] - first[1]);
};
const sixDecimals = (value) => Math.round(value * 1_000_000) / 1_000_000;
export const expectedPt = (actualMm) => actualMm * PT_PER_MM;
export function scaleHint(factor) {
    if (Math.abs(factor / PT_PER_MM - 1) <= SCALE_REFERENCE_HINT_TOLERANCE)
        return 'mm_read_as_pt';
    if (Math.abs(factor / MM_PER_PT - 1) <= SCALE_REFERENCE_HINT_TOLERANCE)
        return 'pt_read_as_mm';
    return 'none';
}
function row(index, base, measuredPt, actual) {
    if (!(measuredPt > 0))
        throw new Error(`reference ${index}: the measured length is 0, so no factor can be computed (reference_degenerate).`);
    const factor = expectedPt(actual) / measuredPt;
    return { index, ...base, measured_pt: measuredPt, measured_mm_as_read: measuredPt * MM_PER_PT, actual_mm: actual, expected_pt: expectedPt(actual), factor, scale_percent: sixDecimals(factor * 100) };
}
export function computeScaleReferences(references, host) {
    const byUuid = new Map(host.paths.map((path) => [path.uuid, path]));
    const warnings = new Set();
    const rows = references.map((reference, index) => {
        if (reference.kind === 'points') {
            return row(index, { kind: 'points', uuid: null, measure: 'points', length_method: 'points', point_count: null, closed: null }, Math.hypot(reference.to[0] - reference.from[0], reference.to[1] - reference.from[1]), reference.actual_mm);
        }
        const path = byUuid.get(reference.uuid);
        if (path === undefined)
            throw new Error(`reference ${index}: the host did not return the path ${JSON.stringify(reference.uuid)}.`);
        const measure = reference.measure ?? 'length';
        if (measure === 'chord') {
            if (path.points.length < 2)
                throw new Error(`reference ${index}: a chord needs at least two anchors (reference_degenerate).`);
            return row(index, { kind: 'path', uuid: path.uuid, measure, length_method: 'chord', point_count: path.points.length, closed: path.closed }, chordLength(path), reference.actual_mm);
        }
        if (path.closed)
            warnings.add('closed_path_perimeter');
        const measured = pathLength(path);
        return row(index, { kind: 'path', uuid: path.uuid, measure, length_method: measured.method, point_count: path.points.length, closed: path.closed }, measured.length, reference.actual_mm);
    });
    const percents = rows.map((entry) => entry.scale_percent).sort((a, b) => a - b);
    const middle = Math.floor(percents.length / 2);
    const median = sixDecimals(percents.length % 2 === 1 ? percents[middle] : (percents[middle - 1] + percents[middle]) / 2);
    const spread = (percents[percents.length - 1] - percents[0]) / median * 100;
    const consistent = spread <= SCALE_REFERENCE_CONSISTENT_SPREAD_PERCENT;
    if (rows.length === 1)
        warnings.add('single_reference');
    if (!consistent)
        warnings.add('inconsistent_references');
    return { document: host.document, references: rows, summary: { scale_percent: median, spread_percent: spread, consistent, hint: scaleHint(median / 100) }, warnings: [...warnings] };
}
export const MEASURE_SCALE_REFERENCE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var MEASURE_MAX_POINTS = ${SCALE_REFERENCE_MAX_POINTS};
var MEASURE_COORDINATE_LIMIT = ${SCALE_REFERENCE_COORDINATE_LIMIT};
function measureFail(code, uuid, actual) {
  var detail = { code: code, uuid: uuid };
  if (actual !== undefined) detail.actual = actual;
  throw new Error("MCP_ERROR:" + stringifyJson(detail));
}
function measureXY(value, uuid) {
  if (!value || value.length !== 2) measureFail("REFERENCE_UNREADABLE", uuid, "point");
  var x = Number(value[0]), y = Number(value[1]);
  if (!isFinite(x) || !isFinite(y) || Math.abs(x) > MEASURE_COORDINATE_LIMIT || Math.abs(y) > MEASURE_COORDINATE_LIMIT) measureFail("REFERENCE_UNREADABLE", uuid, "coordinate");
  var rx = Math.round(x * 1000000) / 1000000, ry = Math.round(y * 1000000) / 1000000;
  return [rx === 0 ? 0 : rx, ry === 0 ? 0 : ry];
}
var measureContext = requireDocumentForRead(params.expectedDocumentKey);
var measureDocument = app.activeDocument;
var measurePaths = [];
for (var measureIndex = 0; measureIndex < params.uuids.length; measureIndex++) {
  var measureUuid = params.uuids[measureIndex];
  var measureResolved = resolvePageItem(measureDocument, measureUuid);
  if (measureResolved === null) measureFail("REFERENCE_NOT_FOUND", measureUuid);
  if (measureResolved.typename !== "PathItem") measureFail("REFERENCE_NOT_PATH", measureUuid, measureResolved.typename);
  var measureItem = measureResolved.item;
  if (typeof measureItem.uuid !== "string" || measureItem.uuid !== measureUuid) measureFail("REFERENCE_UNREADABLE", measureUuid, "uuid");
  if (String(measureItem.parent.typename) === "CompoundPathItem") measureFail("REFERENCE_NOT_PATH", measureUuid, "compound_path_member");
  var measureCount = measureItem.pathPoints && typeof measureItem.pathPoints.length === "number" ? measureItem.pathPoints.length : -1;
  if (measureCount < 1 || measureCount > MEASURE_MAX_POINTS) measureFail("REFERENCE_TOO_MANY_POINTS", measureUuid, String(measureCount));
  var measurePoints = [];
  for (var measurePointIndex = 0; measurePointIndex < measureCount; measurePointIndex++) {
    var measurePoint = measureItem.pathPoints[measurePointIndex];
    measurePoints.push({
      anchor: measureXY(measurePoint.anchor, measureUuid),
      leftDirection: measureXY(measurePoint.leftDirection, measureUuid),
      rightDirection: measureXY(measurePoint.rightDirection, measureUuid)
    });
  }
  measurePaths.push({ uuid: measureUuid, closed: measureItem.closed === true, points: measurePoints });
}
var result = { document: measureContext, paths: measurePaths };
`;
export function scaleReferenceErrorMessage(detail) {
    const where = JSON.stringify(detail?.uuid ?? '');
    if (detail?.code === 'REFERENCE_NOT_FOUND')
        return `No PageItem with UUID ${where} exists in the bound document (reference_not_found).`;
    if (detail?.code === 'REFERENCE_NOT_PATH')
        return `The item with UUID ${where} is not a measurable PathItem (${detail.actual ?? 'unsupported'}); a compound-path member and other types are refused (reference_not_path).`;
    if (detail?.code === 'REFERENCE_TOO_MANY_POINTS')
        return `The path with UUID ${where} has ${detail.actual ?? 'too many'} points; at most ${SCALE_REFERENCE_MAX_POINTS} are read (reference_too_many_points).`;
    if (detail?.code === 'REFERENCE_UNREADABLE')
        return `The path with UUID ${where} could not be read (${detail.actual ?? 'unreadable'}).`;
    return null;
}
