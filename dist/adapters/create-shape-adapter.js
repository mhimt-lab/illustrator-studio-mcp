import { z } from 'zod';
import { applyCommandIdSchema, canonicalCommandIdSchema } from '../command-id.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity, } from '../mutation-operation-adapter.js';
import { MUTATION_TRANSACTION_SCRIPT } from '../mutation-transaction.js';
import { documentContextSchema, layerPathSchema, mutationAuditSchema } from '../mutation-result-schema-core.js';
import { assertOperationSafetyAdapterConformance, bindOperationSafetyPlan, canonicalDigest, operationSafetyPolicyToMcpAnnotations, operationSafetyRegistrationSchema, operationSafetyResultSchema, } from '../operation-safety-policy-core.js';
export const CREATE_SHAPE_OPERATION = 'create_shape';
export const CREATE_SHAPE_VALIDATOR = { kind: CREATE_SHAPE_OPERATION, version: 1 };
export const CREATE_SHAPE_MAX_DIRECT_ITEMS = 128;
export const CREATE_SHAPE_MAX_LAYER_DEPTH = 64;
export const CREATE_SHAPE_MAX_PATH_POINTS = 256;
export const CREATE_SHAPE_MIN_POLYGON_SIDES = 3;
export const CREATE_SHAPE_MAX_POLYGON_SIDES = 24;
export const CREATE_SHAPE_MIN_STAR_POINTS = 3;
export const CREATE_SHAPE_MAX_STAR_POINTS = 24;
export const CREATE_SHAPE_TOLERANCE_PT = 0.01;
export const CREATE_SHAPE_MAX_COORDINATE_PT = 16_383;
export const CREATE_SHAPE_PRECISION_DIGITS = 6;
const CANONICAL_VERSION = 1;
const RESULT_SCHEMA_VERSION = 1;
const CLASSIFIER_VERSION = 1;
const CONFORMANCE_VERSION = 1;
const ERROR_MAPPING_VERSION = 1;
const canonicalNumberSchema = z.number().finite().min(-CREATE_SHAPE_MAX_COORDINATE_PT).max(CREATE_SHAPE_MAX_COORDINATE_PT)
    .overwrite((value) => Object.is(value, -0) ? 0 : value);
const positiveNumberSchema = z.number().finite().positive().max(CREATE_SHAPE_MAX_COORDINATE_PT);
const pointSchema = z.tuple([canonicalNumberSchema, canonicalNumberSchema]);
function round(value) {
    const rounded = Number(value.toFixed(CREATE_SHAPE_PRECISION_DIGITS));
    return Object.is(rounded, -0) ? 0 : rounded;
}
function samePoint(left, right) {
    return left[0] === right[0] && left[1] === right[1];
}
function orientation(a, b, c) {
    const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    if (Math.abs(value) < 1e-9)
        return 0;
    return value > 0 ? 1 : 2;
}
function onSegment(a, b, c) {
    return Math.min(a[0], c[0]) - 1e-9 <= b[0] && b[0] <= Math.max(a[0], c[0]) + 1e-9 &&
        Math.min(a[1], c[1]) - 1e-9 <= b[1] && b[1] <= Math.max(a[1], c[1]) + 1e-9;
}
function segmentsIntersect(p1, p2, p3, p4) {
    const o1 = orientation(p1, p2, p3);
    const o2 = orientation(p1, p2, p4);
    const o3 = orientation(p3, p4, p1);
    const o4 = orientation(p3, p4, p2);
    if (o1 !== o2 && o3 !== o4)
        return true;
    if (o1 === 0 && onSegment(p1, p3, p2))
        return true;
    if (o2 === 0 && onSegment(p1, p4, p2))
        return true;
    if (o3 === 0 && onSegment(p3, p1, p4))
        return true;
    if (o4 === 0 && onSegment(p3, p2, p4))
        return true;
    return false;
}
function adjacentFoldsBack(a, p, c) {
    return orientation(a, p, c) === 0 && (a[0] - p[0]) * (c[0] - p[0]) + (a[1] - p[1]) * (c[1] - p[1]) > 0;
}
function shoelaceArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current[0] * next[1] - next[0] * current[1];
    }
    return area / 2;
}
export function straightPathSelfIntersects(points, closed) {
    const segments = [];
    for (let index = 0; index + 1 < points.length; index += 1)
        segments.push([points[index], points[index + 1]]);
    if (closed && points.length >= 3)
        segments.push([points[points.length - 1], points[0]]);
    const count = segments.length;
    for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
            const adjacent = j === i + 1 || (closed && i === 0 && j === count - 1);
            if (adjacent) {
                const shared = j === i + 1 ? segments[i][1] : segments[j][1];
                const first = j === i + 1 ? segments[i][0] : segments[j][0];
                const second = j === i + 1 ? segments[j][1] : segments[i][1];
                if (adjacentFoldsBack(first, shared, second))
                    return true;
                continue;
            }
            if (segmentsIntersect(segments[i][0], segments[i][1], segments[j][0], segments[j][1]))
                return true;
        }
    }
    if (closed && points.length >= 3 && Math.abs(shoelaceArea(points)) < 1e-9)
        return true;
    return false;
}
export function derivedGeometryDefect(kind, geometry) {
    const width = geometry.geometricBounds[2] - geometry.geometricBounds[0];
    const height = geometry.geometricBounds[1] - geometry.geometricBounds[3];
    if (kind === 'ellipse' || kind === 'polygon' || kind === 'star') {
        if (!(width > 0) || !(height > 0))
            return 'collapses to zero size after coordinate rounding';
        if (kind === 'star') {
            for (let index = 0; index < geometry.anchors.length; index += 1) {
                if (samePoint(geometry.anchors[index], geometry.anchors[(index + 1) % geometry.anchors.length]))
                    return 'repeats a vertex after coordinate rounding';
            }
        }
        return null;
    }
    for (let index = 0; index + 1 < geometry.anchors.length; index += 1) {
        if (samePoint(geometry.anchors[index], geometry.anchors[index + 1]))
            return 'repeats a point after coordinate rounding';
    }
    if (kind === 'curve') {
        if (geometry.closed && samePoint(geometry.anchors[0], geometry.anchors[geometry.anchors.length - 1]))
            return 'repeats its first point at the end after coordinate rounding';
        if (geometry.closed && (!(width > 0) || !(height > 0)))
            return 'encloses no area after coordinate rounding';
        return null;
    }
    if (geometry.closed && samePoint(geometry.anchors[0], geometry.anchors[geometry.anchors.length - 1]))
        return 'repeats its first point at the end after coordinate rounding';
    if (straightPathSelfIntersects(geometry.anchors, geometry.closed))
        return 'intersects itself';
    return null;
}
const ellipseSchema = z.strictObject({
    kind: z.literal('ellipse'), x: canonicalNumberSchema, y: canonicalNumberSchema, width: positiveNumberSchema, height: positiveNumberSchema,
});
const polygonSchema = z.strictObject({
    kind: z.literal('polygon'), centerX: canonicalNumberSchema, centerY: canonicalNumberSchema, radius: positiveNumberSchema,
    sides: z.number().int().min(CREATE_SHAPE_MIN_POLYGON_SIDES).max(CREATE_SHAPE_MAX_POLYGON_SIDES),
});
const lineSchema = z.strictObject({ kind: z.literal('line'), from: pointSchema, to: pointSchema }).superRefine((line, context) => {
    if (samePoint(line.from, line.to))
        context.addIssue({ code: 'custom', message: 'A line needs two distinct points.' });
});
const pathSchema = z.strictObject({
    kind: z.literal('path'), points: z.array(pointSchema).min(2).max(CREATE_SHAPE_MAX_PATH_POINTS), closed: z.boolean().default(false),
}).superRefine((path, context) => {
    if (path.closed && path.points.length < 3)
        context.addIssue({ code: 'custom', message: 'A closed path needs at least three points.' });
    for (let index = 0; index + 1 < path.points.length; index += 1) {
        if (samePoint(path.points[index], path.points[index + 1])) {
            context.addIssue({ code: 'custom', message: 'A path must not repeat a point consecutively.' });
            return;
        }
    }
    if (path.closed && samePoint(path.points[0], path.points[path.points.length - 1])) {
        context.addIssue({ code: 'custom', message: 'A closed path must not repeat its first point at the end.' });
        return;
    }
    if (straightPathSelfIntersects(path.points, path.closed)) {
        context.addIssue({ code: 'custom', message: 'A path must not intersect itself.' });
    }
});
const starSchema = z.strictObject({
    kind: z.literal('star'), centerX: canonicalNumberSchema, centerY: canonicalNumberSchema,
    outerRadius: positiveNumberSchema, innerRadius: positiveNumberSchema,
    points: z.number().int().min(CREATE_SHAPE_MIN_STAR_POINTS).max(CREATE_SHAPE_MAX_STAR_POINTS),
}).superRefine((star, context) => {
    if (!(star.outerRadius > star.innerRadius))
        context.addIssue({ code: 'custom', message: 'A star needs an outer radius larger than its inner radius.' });
});
const curvePointSchema = z.strictObject({ anchor: pointSchema, left: pointSchema, right: pointSchema, smooth: z.boolean().default(false) });
const curveSchema = z.strictObject({
    kind: z.literal('curve'), points: z.array(curvePointSchema).min(2).max(CREATE_SHAPE_MAX_PATH_POINTS), closed: z.boolean().default(false),
}).superRefine((curve, context) => {
    for (let index = 0; index + 1 < curve.points.length; index += 1) {
        if (samePoint(curve.points[index].anchor, curve.points[index + 1].anchor)) {
            context.addIssue({ code: 'custom', message: 'A curve must not repeat an anchor consecutively.' });
            return;
        }
    }
    if (curve.closed && curve.points.length > 2 && samePoint(curve.points[0].anchor, curve.points[curve.points.length - 1].anchor)) {
        context.addIssue({ code: 'custom', message: 'A closed curve must not repeat its first anchor at the end.' });
    }
});
export const createShapeShapeSchema = z.discriminatedUnion('kind', [ellipseSchema, polygonSchema, lineSchema, pathSchema, starSchema, curveSchema]);
const publicEllipseSchema = ellipseSchema;
const publicPolygonSchema = z.strictObject({
    kind: z.literal('polygon'), center_x: canonicalNumberSchema, center_y: canonicalNumberSchema, radius: positiveNumberSchema,
    sides: z.number().int().min(CREATE_SHAPE_MIN_POLYGON_SIDES).max(CREATE_SHAPE_MAX_POLYGON_SIDES),
});
const publicStarSchema = z.strictObject({
    kind: z.literal('star'), center_x: canonicalNumberSchema, center_y: canonicalNumberSchema,
    outer_radius: positiveNumberSchema, inner_radius: positiveNumberSchema,
    points: z.number().int().min(CREATE_SHAPE_MIN_STAR_POINTS).max(CREATE_SHAPE_MAX_STAR_POINTS),
}).superRefine((star, context) => {
    if (!(star.outer_radius > star.inner_radius))
        context.addIssue({ code: 'custom', message: 'A star needs an outer radius larger than its inner radius.' });
});
const publicShapeSchema = z.discriminatedUnion('kind', [publicEllipseSchema, publicPolygonSchema, lineSchema, pathSchema, publicStarSchema, curveSchema]);
const handleSchema = z.strictObject({ left: z.tuple([z.number().finite(), z.number().finite()]), right: z.tuple([z.number().finite(), z.number().finite()]), smooth: z.boolean() });
const geometrySchema = z.strictObject({
    closed: z.boolean(),
    anchors: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2).max(CREATE_SHAPE_MAX_PATH_POINTS),
    geometricBounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
    handles: z.array(handleSchema).min(2).max(CREATE_SHAPE_MAX_PATH_POINTS).optional(),
}).superRefine((geometry, context) => {
    if (geometry.handles !== undefined && geometry.handles.length !== geometry.anchors.length) {
        context.addIssue({ code: 'custom', message: 'Curve handles must match the anchor count.' });
    }
});
export function cubicBezierBounds(points, closed) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
    for (const point of points)
        include(point.anchor[0], point.anchor[1]);
    const segments = [];
    for (let index = 0; index + 1 < points.length; index += 1)
        segments.push([points[index], points[index + 1]]);
    if (closed && points.length >= 2)
        segments.push([points[points.length - 1], points[0]]);
    for (const [a, b] of segments) {
        const p0 = a.anchor, p1 = a.right, p2 = b.left, p3 = b.anchor;
        for (const axis of [0, 1]) {
            const c0 = p0[axis], c1 = p1[axis], c2 = p2[axis], c3 = p3[axis];
            const qa = -c0 + 3 * c1 - 3 * c2 + c3, qb = 2 * (c0 - 2 * c1 + c2), qc = -c0 + c1;
            const roots = [];
            if (Math.abs(qa) < 1e-12) {
                if (Math.abs(qb) > 1e-12)
                    roots.push(-qc / qb);
            }
            else {
                const d = qb * qb - 4 * qa * qc;
                if (d >= 0) {
                    const sq = Math.sqrt(d);
                    roots.push((-qb + sq) / (2 * qa), (-qb - sq) / (2 * qa));
                }
            }
            for (const t of roots) {
                if (!(t > 0 && t < 1))
                    continue;
                const u = 1 - t;
                include(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
            }
        }
    }
    return [round(minX), round(maxY), round(maxX), round(minY)];
}
export function deriveShapeGeometry(artboardBounds, shape) {
    const docX = (x) => round(artboardBounds[0] + x);
    const docY = (y) => round(artboardBounds[1] - y);
    let anchors;
    let closed;
    if (shape.kind === 'star') {
        const cx = docX(shape.centerX);
        const cy = docY(shape.centerY);
        anchors = Array.from({ length: shape.points * 2 }, (_value, k) => {
            const radius = k % 2 === 0 ? shape.outerRadius : shape.innerRadius;
            const angle = (Math.PI * k) / shape.points;
            return [round(cx + radius * Math.sin(angle)), round(cy + radius * Math.cos(angle))];
        });
        closed = true;
    }
    else if (shape.kind === 'curve') {
        const points = shape.points.map((point) => ({
            anchor: [docX(point.anchor[0]), docY(point.anchor[1])],
            left: [docX(point.left[0]), docY(point.left[1])],
            right: [docX(point.right[0]), docY(point.right[1])],
            smooth: point.smooth,
        }));
        return {
            closed: shape.closed,
            anchors: points.map((point) => point.anchor),
            geometricBounds: cubicBezierBounds(points, shape.closed),
            handles: points.map((point) => ({ left: point.left, right: point.right, smooth: point.smooth })),
        };
    }
    else if (shape.kind === 'ellipse') {
        const left = docX(shape.x);
        const top = docY(shape.y);
        const right = round(left + shape.width);
        const bottom = round(top - shape.height);
        const cx = round(left + shape.width / 2);
        const cy = round(top - shape.height / 2);
        anchors = [[left, cy], [cx, top], [right, cy], [cx, bottom]];
        closed = true;
    }
    else if (shape.kind === 'polygon') {
        const cx = docX(shape.centerX);
        const cy = docY(shape.centerY);
        const offset = shape.sides % 2 === 0 ? -Math.PI / shape.sides : 0;
        anchors = Array.from({ length: shape.sides }, (_value, k) => {
            const angle = (2 * Math.PI * k) / shape.sides + offset;
            return [round(cx - shape.radius * Math.sin(angle)), round(cy + shape.radius * Math.cos(angle))];
        });
        closed = true;
    }
    else if (shape.kind === 'line') {
        anchors = [[docX(shape.from[0]), docY(shape.from[1])], [docX(shape.to[0]), docY(shape.to[1])]];
        closed = false;
    }
    else {
        anchors = shape.points.map((point) => [docX(point[0]), docY(point[1])]);
        closed = shape.closed;
    }
    const xs = anchors.map((point) => point[0]);
    const ys = anchors.map((point) => point[1]);
    return { closed, anchors, geometricBounds: [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)] };
}
export function geometryWithinTolerance(left, right) {
    const near = (a, b) => Math.abs(a[0] - b[0]) <= CREATE_SHAPE_TOLERANCE_PT && Math.abs(a[1] - b[1]) <= CREATE_SHAPE_TOLERANCE_PT;
    if ((left.handles === undefined) !== (right.handles === undefined))
        return false;
    if (left.handles !== undefined && right.handles !== undefined && (left.handles.length !== right.handles.length ||
        left.handles.some((handle, index) => handle.smooth !== right.handles[index].smooth || !near(handle.left, right.handles[index].left) || !near(handle.right, right.handles[index].right))))
        return false;
    return left.closed === right.closed && left.anchors.length === right.anchors.length &&
        left.anchors.every((point, index) => near(point, right.anchors[index])) &&
        left.geometricBounds.every((value, index) => Math.abs(value - right.geometricBounds[index]) <= CREATE_SHAPE_TOLERANCE_PT);
}
const commonInternal = {
    expectedDocumentKey: z.string().min(1).max(16_384),
    expectedLayerPath: layerPathSchema,
    artboardIndex: z.number().int().safe().nonnegative(),
    shape: createShapeShapeSchema,
    name: z.string().max(255).optional(),
};
const internalInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonInternal, apply: z.literal(false) }),
    z.strictObject({ ...commonInternal, apply: z.literal(true), commandId: canonicalCommandIdSchema }),
]);
const commonPublic = {
    expected_document_key: z.string().min(1).max(16_384),
    expected_layer_path: layerPathSchema,
    artboard_index: z.number().int().safe().nonnegative(),
    shape: publicShapeSchema,
    name: z.string().max(255).optional(),
};
export const createShapePublicInputSchema = z.discriminatedUnion('apply', [
    z.strictObject({ ...commonPublic, apply: z.literal(false).default(false) }),
    z.strictObject({ ...commonPublic, apply: z.literal(true), command_id: applyCommandIdSchema }),
]);
const inputSchema = z.strictObject({ ...commonPublic, apply: z.boolean().default(false), command_id: applyCommandIdSchema.optional() });
const { $schema: _schemaDialect, ...publishedInputSchema } = z.toJSONSchema(createShapePublicInputSchema, { io: 'input' });
inputSchema._zod.toJSONSchema = () => ({ type: 'object', ...publishedInputSchema });
function normalizePublicInput(input) {
    const value = createShapePublicInputSchema.parse(input);
    let shape;
    if (value.shape.kind === 'polygon')
        shape = { kind: 'polygon', centerX: value.shape.center_x, centerY: value.shape.center_y, radius: value.shape.radius, sides: value.shape.sides };
    else if (value.shape.kind === 'star')
        shape = { kind: 'star', centerX: value.shape.center_x, centerY: value.shape.center_y, outerRadius: value.shape.outer_radius, innerRadius: value.shape.inner_radius, points: value.shape.points };
    else if (value.shape.kind === 'path')
        shape = { kind: 'path', points: value.shape.points, closed: value.shape.closed };
    else if (value.shape.kind === 'curve')
        shape = { kind: 'curve', points: value.shape.points.map((point) => ({ anchor: point.anchor, left: point.left, right: point.right, smooth: point.smooth })), closed: value.shape.closed };
    else
        shape = value.shape;
    const common = {
        expectedDocumentKey: value.expected_document_key, expectedLayerPath: value.expected_layer_path,
        artboardIndex: value.artboard_index, shape, ...(value.name === undefined ? {} : { name: value.name }),
    };
    return value.apply ? { ...common, apply: true, commandId: value.command_id } : { ...common, apply: false };
}
const layerStateSchema = z.strictObject({
    path: layerPathSchema,
    name: z.string().max(255),
    visible: z.boolean(),
    locked: z.boolean(),
    itemUuids: z.array(z.string().min(1).max(255)).max(CREATE_SHAPE_MAX_DIRECT_ITEMS),
    ancestry: z.array(z.strictObject({ name: z.string().max(255), visible: z.boolean(), locked: z.boolean() }))
        .min(1).max(CREATE_SHAPE_MAX_LAYER_DEPTH),
});
const blockerSchema = z.enum(['document_mutation_not_allowed', 'layer_hidden', 'layer_locked', 'layer_item_capacity_exceeded']);
const boundsSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const planSchema = z.strictObject({
    operation: z.literal(CREATE_SHAPE_OPERATION),
    documentKey: z.string().min(1).max(16_384),
    coordinateSpace: z.literal('artboard_top_left'),
    unit: z.literal('pt'),
    artboardIndex: z.number().int().nonnegative(),
    artboardBounds: boundsSchema,
    shape: createShapeShapeSchema,
    name: z.string().max(255).nullable(),
    geometry: geometrySchema,
    withinArtboard: z.boolean(),
    layer: layerStateSchema,
    applyBlockedReasonCodes: z.array(blockerSchema),
    applyAllowed: z.boolean(),
}).superRefine((plan, context) => {
    if (plan.applyAllowed !== (plan.applyBlockedReasonCodes.length === 0)) {
        context.addIssue({ code: 'custom', message: 'Shape creation applyAllowed must require no blockers.' });
    }
    const derived = deriveShapeGeometry(plan.artboardBounds, plan.shape);
    if (canonicalSha256(plan.geometry) !== canonicalSha256(derived)) {
        context.addIssue({ code: 'custom', message: 'Shape plan geometry must equal the geometry derived from the request exactly.' });
    }
    const defect = derivedGeometryDefect(plan.shape.kind, plan.geometry);
    if (defect !== null)
        context.addIssue({ code: 'custom', message: `Shape plan geometry ${defect}.` });
});
const failureSchema = z.strictObject({
    phase: z.enum(['apply', 'verify']), reasonCode: z.enum(['apply_failed', 'verify_mismatch']), message: z.string().min(1).max(500),
}).superRefine((failure, context) => {
    if ((failure.phase === 'apply') !== (failure.reasonCode === 'apply_failed')) {
        context.addIssue({ code: 'custom', message: 'Shape creation failure phase and reason code must match.' });
    }
});
const indeterminateFailureSchema = z.strictObject({
    phase: z.literal('apply'), reasonCode: z.literal('apply_indeterminate'), message: z.string().min(1).max(500),
});
const rollbackEvidence = {
    createdUuid: z.string().min(1).max(255).nullable(),
    restoredItemUuids: z.array(z.string().min(1).max(255)).nullable(),
};
const transactionSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('planned'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('verified'), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('not_required') }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rolled_back'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('verified'), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_failed'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('failed'), reasonCode: z.literal('rollback_failed'),
            message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('apply_indeterminate'), failure: indeterminateFailureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('created_state_unknown'),
            message: z.string().min(1).max(500), createdUuid: z.null(), restoredItemUuids: z.null() }), audit: mutationAuditSchema }),
    z.strictObject({ state: z.literal('rollback_indeterminate'), failure: failureSchema,
        rollback: z.strictObject({ status: z.literal('indeterminate'), reasonCode: z.literal('rollback_indeterminate'),
            message: z.string().min(1).max(500), ...rollbackEvidence }), audit: mutationAuditSchema }),
]).superRefine((transaction, context) => {
    const prefix = ['preflight:started:', 'preflight:succeeded:', 'plan:started:', 'plan:succeeded:'];
    let expected;
    if (transaction.state === 'planned') {
        expected = [...prefix, 'apply:skipped:not_requested', 'verify:skipped:not_requested', 'rollback:skipped:not_requested'];
    }
    else if (transaction.state === 'verified') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:succeeded:', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_failed') {
        expected = [...prefix, 'apply:started:', 'apply:failed:apply_failed', 'verify:skipped:not_required', 'rollback:skipped:not_required'];
    }
    else if (transaction.state === 'apply_indeterminate') {
        expected = [...prefix, 'apply:started:', 'apply:attempted:', 'apply:failed:apply_indeterminate'];
    }
    else {
        const failure = transaction.failure.phase === 'apply'
            ? ['apply:started:', 'apply:attempted:', 'apply:failed:apply_failed', 'verify:skipped:not_required']
            : ['apply:started:', 'apply:attempted:', 'apply:succeeded:', 'verify:started:', 'verify:failed:verify_mismatch'];
        expected = [...prefix, ...failure, 'rollback:started:', transaction.state === 'rolled_back'
                ? 'rollback:succeeded:' : `rollback:failed:${transaction.state === 'rollback_failed' ? 'rollback_failed' : 'rollback_indeterminate'}`];
    }
    const actual = transaction.audit.map((event) => `${event.phase}:${event.event}:${'reasonCode' in event ? event.reasonCode : ''}`);
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        context.addIssue({ code: 'custom', message: 'Shape creation audit sequence does not match transaction state.' });
    }
    transaction.audit.forEach((event, index) => {
        if (event.sequence !== index)
            context.addIssue({ code: 'custom', message: 'Shape creation audit sequence must be contiguous.' });
    });
    if ('failure' in transaction) {
        const matches = transaction.audit.filter((event) => event.event === 'failed' && event.phase === transaction.failure.phase &&
            event.reasonCode === transaction.failure.reasonCode && event.message === transaction.failure.message);
        if (matches.length !== 1)
            context.addIssue({ code: 'custom', message: 'Shape creation failure must match one audit event.' });
    }
});
const createdSchema = z.strictObject({
    uuid: z.string().min(1).max(255),
    type: z.literal('PathItem'),
    name: z.string().max(255),
    geometry: geometrySchema,
    layerItemUuids: z.array(z.string().min(1).max(255)).min(1).max(CREATE_SHAPE_MAX_DIRECT_ITEMS + 1),
});
export const createShapeResultSchema = z.union([
    z.strictObject({ operation: z.literal(CREATE_SHAPE_OPERATION), applied: z.literal(false),
        document: documentContextSchema, plan: planSchema, transaction: transactionSchema }),
    z.strictObject({ operation: z.literal(CREATE_SHAPE_OPERATION), applied: z.literal(true),
        document: documentContextSchema, plan: planSchema, created: createdSchema, transaction: transactionSchema }),
]).superRefine((result, context) => {
    if (result.transaction.state === 'planned') {
        const blockers = [];
        if (!result.document.mutationAllowed)
            blockers.push('document_mutation_not_allowed');
        if (result.plan.layer.ancestry.some((ancestor) => !ancestor.visible))
            blockers.push('layer_hidden');
        if (result.plan.layer.ancestry.some((ancestor) => ancestor.locked))
            blockers.push('layer_locked');
        if (result.plan.layer.itemUuids.length >= CREATE_SHAPE_MAX_DIRECT_ITEMS)
            blockers.push('layer_item_capacity_exceeded');
        if (canonicalSha256(result.plan.applyBlockedReasonCodes) !== canonicalSha256(blockers)) {
            context.addIssue({ code: 'custom', message: 'Planned shape creation must expose exact blockers.' });
        }
    }
    else if (result.plan.applyBlockedReasonCodes.length !== 0 || !result.plan.applyAllowed ||
        result.plan.layer.ancestry.some((ancestor) => !ancestor.visible || ancestor.locked) ||
        result.plan.layer.itemUuids.length >= CREATE_SHAPE_MAX_DIRECT_ITEMS) {
        context.addIssue({ code: 'custom', message: 'Applied shape creation must derive from an allowed plan.' });
    }
    if (result.applied) {
        if (result.transaction.state !== 'verified') {
            context.addIssue({ code: 'custom', message: 'A created shape must come from a verified transaction.' });
        }
        if (result.created.layerItemUuids[0] !== result.created.uuid ||
            result.created.layerItemUuids.length !== result.plan.layer.itemUuids.length + 1 ||
            result.created.layerItemUuids.slice(1).some((uuid, index) => uuid !== result.plan.layer.itemUuids[index])) {
            context.addIssue({ code: 'custom', message: 'A created shape must be the only new item, at the front, with the prior order intact.' });
        }
        if (!geometryWithinTolerance(result.created.geometry, result.plan.geometry) ||
            (result.plan.name !== null && result.created.name !== result.plan.name)) {
            context.addIssue({ code: 'custom', message: 'A created shape must match the planned geometry and name.' });
        }
    }
    else if (result.transaction.state === 'verified') {
        context.addIssue({ code: 'custom', message: 'A verified shape creation must report the created item.' });
    }
    if (result.transaction.state === 'rolled_back') {
        const rollback = result.transaction.rollback;
        if (rollback.createdUuid === null || rollback.restoredItemUuids === null ||
            canonicalSha256(rollback.restoredItemUuids) !== canonicalSha256(result.plan.layer.itemUuids)) {
            context.addIssue({ code: 'custom', message: 'A rolled-back shape creation must name the removed UUID and prove the exact baseline order.' });
        }
    }
    if (result.transaction.state === 'rollback_failed' && result.transaction.rollback.createdUuid === null) {
        context.addIssue({ code: 'custom', message: 'A failed shape rollback must name the UUID that is still present.' });
    }
});
export const createShapeResponseSchema = z.strictObject({
    outcome: createShapeResultSchema,
    delivery: z.strictObject({ mode: z.enum(['original', 'replay']), finalizedAt: z.string().datetime({ offset: true }) }),
});
export const CREATE_SHAPE_SAFETY = operationSafetyRegistrationSchema.parse({
    operationId: CREATE_SHAPE_OPERATION,
    policy: {
        version: 1, class: 'create', destructive: false,
        evidence: { identity: 'native_uuid', ownership: 'self_created_only', postcondition: 'created_state_matches_plan' },
        preconditions: { documentBinding: 'explicit_document_key', targetValidation: 'same_execution_before_apply' },
        confirmation: 'risk_scoped',
        recovery: { mode: 'remove_self_created_uuid', verification: 'native_uuid_absent', unknownIdentity: 'indeterminate' },
        terminal: { success: 'verified', failure: 'proven_pre_apply_or_verified_recovery', partialSuccess: 'nonterminal_until_reconciled' },
        replay: { requestBinding: 'canonical_request_digest', retry: 'return_attested_terminal_result', beforeTerminal: 'reconcile_required', reapplyOnRetry: false },
    },
    capabilities: {
        class: 'create', explicitDocumentBinding: true, validateTargetsBeforeApply: true, captureNativeUuid: true,
        verifyCreatedState: true, rollbackSelfCreatedUuidOnly: true, verifyRollbackAbsence: true, reconcileIndeterminate: true,
        durableTerminalReplay: true, trustedTerminalAttestationResolver: true,
    },
});
export const CREATE_SHAPE_SAFETY_IDENTITY = canonicalDigest(CREATE_SHAPE_SAFETY);
function safetyPlan(result, requestDigest, admissionDocumentKey = result.document.key) {
    return bindOperationSafetyPlan({
        policyVersion: 1, operationClass: 'create', operationId: CREATE_SHAPE_OPERATION, canonicalRequestDigest: requestDigest,
        evidence: { documentKey: admissionDocumentKey,
            targetLocator: `layer:${result.plan.layer.path.join('.')};artboard:${result.plan.artboardIndex};shape:${result.plan.shape.kind}` },
        preconditions: { status: result.plan.applyBlockedReasonCodes.length === 0 ? 'satisfied' : 'blocked',
            targetsValidated: result.plan.applyBlockedReasonCodes.length === 0 },
        confirmation: { kind: 'risk_scoped', status: 'not_required' },
        applyAllowed: result.plan.applyAllowed,
    });
}
function safetyResult(result, requestDigest, attestation, plan) {
    const transaction = result.transaction;
    if (transaction.state === 'planned' || transaction.state === 'apply_indeterminate' || transaction.state === 'rollback_indeterminate') {
        throw new Error('Indeterminate shape creation cannot be terminal.');
    }
    const common = { policyVersion: 1, operationClass: 'create', operationId: CREATE_SHAPE_OPERATION,
        canonicalRequestDigest: requestDigest, planDigest: plan.planDigest, attestation };
    if (result.applied && transaction.state === 'verified') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: result.created.uuid, ownership: 'self_created_only', postconditionVerified: true, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'succeeded', terminal: true, recovery: 'not_required', proof: { kind: 'verified_postcondition' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rolled_back') {
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid: transaction.rollback.createdUuid, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
            executionEvidence: { outcome: 'completed' },
            resolution: { status: 'recovered', terminal: true, recovery: 'verified', proof: { kind: 'verified_recovery' },
                replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    if (transaction.state === 'rollback_failed') {
        const nativeUuid = transaction.rollback.createdUuid;
        return operationSafetyResultSchema.parse({ ...common,
            evidence: { nativeUuid, ownership: 'self_created_only', postconditionVerified: false,
                outstandingEffect: nativeUuid === null ? null : { kind: 'native_uuid_still_present', nativeUuid } },
            executionEvidence: { outcome: 'recovery_failed' },
            resolution: { status: 'recovery_failed', terminal: true, recovery: 'failed', outstandingEffect: 'known_effect_present',
                proof: { kind: 'verified_outstanding_effect' }, replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
    }
    return operationSafetyResultSchema.parse({ ...common,
        evidence: { nativeUuid: null, ownership: 'self_created_only', postconditionVerified: false, outstandingEffect: null },
        executionEvidence: { outcome: 'proven_pre_apply' },
        resolution: { status: 'failed', terminal: true, recovery: 'not_required', proof: { kind: 'proven_pre_apply', mutationAttempted: false },
            replay: { status: 'durable_terminal', action: 'return_attested_result', reapply: false } } });
}
async function assertSafety(value, requestDigest, attestation, resolver) {
    const result = createShapeResultSchema.parse(value);
    const plan = safetyPlan(result, requestDigest, attestation?.documentKey);
    if (result.transaction.state === 'planned')
        return;
    if (attestation === null || resolver === null)
        throw new Error('Shape creation terminal result requires attestation.');
    await assertOperationSafetyAdapterConformance({ registration: CREATE_SHAPE_SAFETY, plan, result: safetyResult(result, requestDigest, attestation, plan) }, resolver);
}
export const CREATE_SHAPE_SCRIPT = `${MUTATION_TRANSACTION_SCRIPT}
var CREATE_SHAPE_MAX_DIRECT_ITEMS = ${CREATE_SHAPE_MAX_DIRECT_ITEMS};
var CREATE_SHAPE_MAX_LAYER_DEPTH = ${CREATE_SHAPE_MAX_LAYER_DEPTH};
var CREATE_SHAPE_MAX_PATH_POINTS = ${CREATE_SHAPE_MAX_PATH_POINTS};
var CREATE_SHAPE_MIN_POLYGON_SIDES = ${CREATE_SHAPE_MIN_POLYGON_SIDES};
var CREATE_SHAPE_MAX_POLYGON_SIDES = ${CREATE_SHAPE_MAX_POLYGON_SIDES};
var CREATE_SHAPE_MIN_STAR_POINTS = ${CREATE_SHAPE_MIN_STAR_POINTS};
var CREATE_SHAPE_MAX_STAR_POINTS = ${CREATE_SHAPE_MAX_STAR_POINTS};
var CREATE_SHAPE_TOLERANCE_PT = ${CREATE_SHAPE_TOLERANCE_PT};
var CREATE_SHAPE_PRECISION_DIGITS = ${CREATE_SHAPE_PRECISION_DIGITS};

function shapeRound(value) {
  var rounded = Number(mutationFiniteNumber(value, "geometry").toFixed(CREATE_SHAPE_PRECISION_DIGITS));
  return rounded === 0 ? 0 : rounded;
}
function shapeSamePoint(left, right) { return left[0] === right[0] && left[1] === right[1]; }
function shapeOrientation(a, b, c) {
  var value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}
function shapeOnSegment(a, b, c) {
  return Math.min(a[0], c[0]) - 1e-9 <= b[0] && b[0] <= Math.max(a[0], c[0]) + 1e-9 &&
    Math.min(a[1], c[1]) - 1e-9 <= b[1] && b[1] <= Math.max(a[1], c[1]) + 1e-9;
}
function shapeSegmentsIntersect(p1, p2, p3, p4) {
  var o1 = shapeOrientation(p1, p2, p3), o2 = shapeOrientation(p1, p2, p4);
  var o3 = shapeOrientation(p3, p4, p1), o4 = shapeOrientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && shapeOnSegment(p1, p3, p2)) return true;
  if (o2 === 0 && shapeOnSegment(p1, p4, p2)) return true;
  if (o3 === 0 && shapeOnSegment(p3, p1, p4)) return true;
  if (o4 === 0 && shapeOnSegment(p3, p2, p4)) return true;
  return false;
}
function shapeFoldsBack(a, p, c) {
  return shapeOrientation(a, p, c) === 0 && (a[0] - p[0]) * (c[0] - p[0]) + (a[1] - p[1]) * (c[1] - p[1]) > 0;
}
function shapeArea(points) {
  var area = 0;
  for (var index = 0; index < points.length; index++) {
    var current = points[index], next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}
function shapeSelfIntersects(points, closed) {
  var segments = [];
  for (var index = 0; index + 1 < points.length; index++) segments.push([points[index], points[index + 1]]);
  if (closed && points.length >= 3) segments.push([points[points.length - 1], points[0]]);
  var count = segments.length;
  for (var i = 0; i < count; i++) {
    for (var j = i + 1; j < count; j++) {
      var adjacent = j === i + 1 || (closed && i === 0 && j === count - 1);
      if (adjacent) {
        var shared = j === i + 1 ? segments[i][1] : segments[j][1];
        var first = j === i + 1 ? segments[i][0] : segments[j][0];
        var second = j === i + 1 ? segments[j][1] : segments[i][1];
        if (shapeFoldsBack(first, shared, second)) return true;
        continue;
      }
      if (shapeSegmentsIntersect(segments[i][0], segments[i][1], segments[j][0], segments[j][1])) return true;
    }
  }
  if (closed && points.length >= 3 && Math.abs(shapeArea(points)) < 1e-9) return true;
  return false;
}
/** Degeneracy re-checked on the derived geometry, after coordinate conversion and rounding. */
function shapeDerivedDefect(kind, geometry) {
  var width = geometry.geometricBounds[2] - geometry.geometricBounds[0];
  var height = geometry.geometricBounds[1] - geometry.geometricBounds[3];
  if (kind === "ellipse" || kind === "polygon" || kind === "star") {
    if (!(width > 0 && height > 0)) return "collapses to zero size after coordinate rounding";
    if (kind === "star") {
      for (var sv = 0; sv < geometry.anchors.length; sv++) {
        if (shapeSamePoint(geometry.anchors[sv], geometry.anchors[(sv + 1) % geometry.anchors.length])) return "repeats a vertex after coordinate rounding";
      }
    }
    return null;
  }
  for (var index = 0; index + 1 < geometry.anchors.length; index++) {
    if (shapeSamePoint(geometry.anchors[index], geometry.anchors[index + 1])) return "repeats a point after coordinate rounding";
  }
  if (kind === "curve") {
    if (geometry.closed && shapeSamePoint(geometry.anchors[0], geometry.anchors[geometry.anchors.length - 1])) return "repeats its first point at the end after coordinate rounding";
    if (geometry.closed && !(width > 0 && height > 0)) return "encloses no area after coordinate rounding";
    return null;
  }
  if (geometry.closed && shapeSamePoint(geometry.anchors[0], geometry.anchors[geometry.anchors.length - 1])) return "repeats its first point at the end after coordinate rounding";
  if (shapeSelfIntersects(geometry.anchors, geometry.closed)) return "intersects itself";
  return null;
}
function shapeGeometryExact(left, right) { return stringifyJson(left) === stringifyJson(right); }

/** Re-checks every plan-side rejection so a caller cannot reach the host with a degenerate request. */
function shapeValidateRequest(shape) {
  if (!shape || typeof shape.kind !== "string") throw mutationError("preflight_failed", "A shape variant is required.");
  if (shape.kind === "ellipse") {
    mutationFiniteNumber(shape.x, "shape.x"); mutationFiniteNumber(shape.y, "shape.y");
    if (!(mutationFiniteNumber(shape.width, "shape.width") > 0) || !(mutationFiniteNumber(shape.height, "shape.height") > 0)) {
      throw mutationError("preflight_failed", "An ellipse needs a positive width and height.");
    }
    return;
  }
  if (shape.kind === "polygon") {
    mutationFiniteNumber(shape.centerX, "shape.centerX"); mutationFiniteNumber(shape.centerY, "shape.centerY");
    if (!(mutationFiniteNumber(shape.radius, "shape.radius") > 0)) throw mutationError("preflight_failed", "A polygon needs a positive radius.");
    if (typeof shape.sides !== "number" || Math.floor(shape.sides) !== shape.sides ||
        shape.sides < CREATE_SHAPE_MIN_POLYGON_SIDES || shape.sides > CREATE_SHAPE_MAX_POLYGON_SIDES) {
      throw mutationError("preflight_failed", "A polygon needs " + CREATE_SHAPE_MIN_POLYGON_SIDES + " to " + CREATE_SHAPE_MAX_POLYGON_SIDES + " sides.");
    }
    return;
  }
  if (shape.kind === "line") {
    if (!shape.from || !shape.to || shape.from.length !== 2 || shape.to.length !== 2) throw mutationError("preflight_failed", "A line needs two points.");
    mutationFiniteNumber(shape.from[0], "shape.from[0]"); mutationFiniteNumber(shape.from[1], "shape.from[1]");
    mutationFiniteNumber(shape.to[0], "shape.to[0]"); mutationFiniteNumber(shape.to[1], "shape.to[1]");
    if (shapeSamePoint(shape.from, shape.to)) throw mutationError("preflight_failed", "A line needs two distinct points.");
    return;
  }
  if (shape.kind === "path") {
    if (!shape.points || typeof shape.points.length !== "number" || shape.points.length < 2 || shape.points.length > CREATE_SHAPE_MAX_PATH_POINTS) {
      throw mutationError("preflight_failed", "A path needs 2 to " + CREATE_SHAPE_MAX_PATH_POINTS + " points.");
    }
    if (typeof shape.closed !== "boolean") throw mutationError("preflight_failed", "A path needs an explicit closed flag.");
    if (shape.closed && shape.points.length < 3) throw mutationError("preflight_failed", "A closed path needs at least three points.");
    for (var index = 0; index < shape.points.length; index++) {
      var point = shape.points[index];
      if (!point || point.length !== 2) throw mutationError("preflight_failed", "A path point needs two coordinates.");
      mutationFiniteNumber(point[0], "shape.points[" + index + "][0]"); mutationFiniteNumber(point[1], "shape.points[" + index + "][1]");
      if (index > 0 && shapeSamePoint(shape.points[index - 1], point)) throw mutationError("preflight_failed", "A path must not repeat a point consecutively.");
    }
    if (shape.closed && shapeSamePoint(shape.points[0], shape.points[shape.points.length - 1])) {
      throw mutationError("preflight_failed", "A closed path must not repeat its first point at the end.");
    }
    if (shapeSelfIntersects(shape.points, shape.closed)) throw mutationError("preflight_failed", "A path must not intersect itself.");
    return;
  }
  if (shape.kind === "star") {
    mutationFiniteNumber(shape.centerX, "shape.centerX"); mutationFiniteNumber(shape.centerY, "shape.centerY");
    if (!(mutationFiniteNumber(shape.outerRadius, "shape.outerRadius") > 0) || !(mutationFiniteNumber(shape.innerRadius, "shape.innerRadius") > 0) ||
        !(shape.outerRadius > shape.innerRadius)) {
      throw mutationError("preflight_failed", "A star needs an outer radius larger than a positive inner radius.");
    }
    if (typeof shape.points !== "number" || Math.floor(shape.points) !== shape.points ||
        shape.points < CREATE_SHAPE_MIN_STAR_POINTS || shape.points > CREATE_SHAPE_MAX_STAR_POINTS) {
      throw mutationError("preflight_failed", "A star needs " + CREATE_SHAPE_MIN_STAR_POINTS + " to " + CREATE_SHAPE_MAX_STAR_POINTS + " points.");
    }
    return;
  }
  if (shape.kind === "curve") {
    if (!shape.points || typeof shape.points.length !== "number" || shape.points.length < 2 || shape.points.length > CREATE_SHAPE_MAX_PATH_POINTS) {
      throw mutationError("preflight_failed", "A curve needs 2 to " + CREATE_SHAPE_MAX_PATH_POINTS + " points.");
    }
    if (typeof shape.closed !== "boolean") throw mutationError("preflight_failed", "A curve needs an explicit closed flag.");
    for (var c = 0; c < shape.points.length; c++) {
      var cp = shape.points[c];
      if (!cp || !cp.anchor || cp.anchor.length !== 2 || !cp.left || cp.left.length !== 2 || !cp.right || cp.right.length !== 2 || typeof cp.smooth !== "boolean") {
        throw mutationError("preflight_failed", "A curve point needs anchor, left, right, and smooth.");
      }
      mutationFiniteNumber(cp.anchor[0], "curve.anchor[0]"); mutationFiniteNumber(cp.anchor[1], "curve.anchor[1]");
      mutationFiniteNumber(cp.left[0], "curve.left[0]"); mutationFiniteNumber(cp.left[1], "curve.left[1]");
      mutationFiniteNumber(cp.right[0], "curve.right[0]"); mutationFiniteNumber(cp.right[1], "curve.right[1]");
      if (c > 0 && shapeSamePoint(shape.points[c - 1].anchor, cp.anchor)) throw mutationError("preflight_failed", "A curve must not repeat an anchor consecutively.");
    }
    if (shape.closed && shape.points.length > 2 && shapeSamePoint(shape.points[0].anchor, shape.points[shape.points.length - 1].anchor)) {
      throw mutationError("preflight_failed", "A closed curve must not repeat its first anchor at the end.");
    }
    return;
  }
  throw mutationError("preflight_failed", "Unsupported shape kind " + shape.kind + ".");
}

/** Bounds of a cubic-Bezier path from anchors and handles; identical to the TypeScript derivation. */
function shapeBezierBounds(points, closed) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function include(x, y) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  for (var i = 0; i < points.length; i++) include(points[i].anchor[0], points[i].anchor[1]);
  var segments = [];
  for (var s = 0; s + 1 < points.length; s++) segments.push([points[s], points[s + 1]]);
  if (closed && points.length >= 2) segments.push([points[points.length - 1], points[0]]);
  for (var g = 0; g < segments.length; g++) {
    var p0 = segments[g][0].anchor, p1 = segments[g][0].right, p2 = segments[g][1].left, p3 = segments[g][1].anchor;
    for (var axis = 0; axis < 2; axis++) {
      var c0 = p0[axis], c1 = p1[axis], c2 = p2[axis], c3 = p3[axis];
      var qa = -c0 + 3 * c1 - 3 * c2 + c3, qb = 2 * (c0 - 2 * c1 + c2), qc = -c0 + c1;
      var roots = [];
      if (Math.abs(qa) < 1e-12) { if (Math.abs(qb) > 1e-12) roots.push(-qc / qb); }
      else { var d = qb * qb - 4 * qa * qc; if (d >= 0) { var sq = Math.sqrt(d); roots.push((-qb + sq) / (2 * qa)); roots.push((-qb - sq) / (2 * qa)); } }
      for (var r = 0; r < roots.length; r++) {
        var t = roots[r];
        if (!(t > 0 && t < 1)) continue;
        var u = 1 - t;
        include(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
          u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
      }
    }
  }
  return [shapeRound(minX), shapeRound(maxY), shapeRound(maxX), shapeRound(minY)];
}

/** The planned geometry in document coordinates; identical to the TypeScript derivation. */
function shapeDerive(rect, shape) {
  function docX(x) { return shapeRound(rect[0] + x); }
  function docY(y) { return shapeRound(rect[1] - y); }
  var anchors = [];
  var closed;
  if (shape.kind === "star") {
    var scx = docX(shape.centerX), scy = docY(shape.centerY);
    for (var sk = 0; sk < shape.points * 2; sk++) {
      var sr = sk % 2 === 0 ? shape.outerRadius : shape.innerRadius;
      var sa = (Math.PI * sk) / shape.points;
      anchors.push([shapeRound(scx + sr * Math.sin(sa)), shapeRound(scy + sr * Math.cos(sa))]);
    }
    closed = true;
  } else if (shape.kind === "curve") {
    var curvePoints = [];
    var handles = [];
    for (var cq = 0; cq < shape.points.length; cq++) {
      var cpt = shape.points[cq];
      var converted = {
        anchor: [docX(cpt.anchor[0]), docY(cpt.anchor[1])],
        left: [docX(cpt.left[0]), docY(cpt.left[1])],
        right: [docX(cpt.right[0]), docY(cpt.right[1])]
      };
      curvePoints.push(converted);
      anchors.push(converted.anchor);
      handles.push({ left: converted.left, right: converted.right, smooth: cpt.smooth });
    }
    return { closed: shape.closed, anchors: anchors, geometricBounds: shapeBezierBounds(curvePoints, shape.closed), handles: handles };
  } else if (shape.kind === "ellipse") {
    var left = docX(shape.x), top = docY(shape.y);
    var right = shapeRound(left + shape.width), bottom = shapeRound(top - shape.height);
    var ecx = shapeRound(left + shape.width / 2), ecy = shapeRound(top - shape.height / 2);
    anchors = [[left, ecy], [ecx, top], [right, ecy], [ecx, bottom]];
    closed = true;
  } else if (shape.kind === "polygon") {
    var cx = docX(shape.centerX), cy = docY(shape.centerY);
    var offset = shape.sides % 2 === 0 ? -Math.PI / shape.sides : 0;
    for (var k = 0; k < shape.sides; k++) {
      var angle = (2 * Math.PI * k) / shape.sides + offset;
      anchors.push([shapeRound(cx - shape.radius * Math.sin(angle)), shapeRound(cy + shape.radius * Math.cos(angle))]);
    }
    closed = true;
  } else if (shape.kind === "line") {
    anchors = [[docX(shape.from[0]), docY(shape.from[1])], [docX(shape.to[0]), docY(shape.to[1])]];
    closed = false;
  } else {
    for (var p = 0; p < shape.points.length; p++) anchors.push([docX(shape.points[p][0]), docY(shape.points[p][1])]);
    closed = shape.closed;
  }
  var minX = anchors[0][0], maxX = anchors[0][0], minY = anchors[0][1], maxY = anchors[0][1];
  for (var a = 1; a < anchors.length; a++) {
    if (anchors[a][0] < minX) minX = anchors[a][0]; if (anchors[a][0] > maxX) maxX = anchors[a][0];
    if (anchors[a][1] < minY) minY = anchors[a][1]; if (anchors[a][1] > maxY) maxY = anchors[a][1];
  }
  return { closed: closed, anchors: anchors, geometricBounds: [minX, maxY, maxX, minY] };
}

function shapeGeometryMatches(left, right) {
  if (!left || !right || left.closed !== right.closed || left.anchors.length !== right.anchors.length) return false;
  if ((left.handles === undefined) !== (right.handles === undefined)) return false;
  if (left.handles !== undefined) {
    if (left.handles.length !== right.handles.length) return false;
    for (var h = 0; h < left.handles.length; h++) {
      if (left.handles[h].smooth !== right.handles[h].smooth ||
          Math.abs(left.handles[h].left[0] - right.handles[h].left[0]) > CREATE_SHAPE_TOLERANCE_PT || Math.abs(left.handles[h].left[1] - right.handles[h].left[1]) > CREATE_SHAPE_TOLERANCE_PT ||
          Math.abs(left.handles[h].right[0] - right.handles[h].right[0]) > CREATE_SHAPE_TOLERANCE_PT || Math.abs(left.handles[h].right[1] - right.handles[h].right[1]) > CREATE_SHAPE_TOLERANCE_PT) return false;
    }
  }
  for (var index = 0; index < left.anchors.length; index++) {
    if (Math.abs(left.anchors[index][0] - right.anchors[index][0]) > CREATE_SHAPE_TOLERANCE_PT ||
        Math.abs(left.anchors[index][1] - right.anchors[index][1]) > CREATE_SHAPE_TOLERANCE_PT) return false;
  }
  for (var b = 0; b < 4; b++) if (Math.abs(left.geometricBounds[b] - right.geometricBounds[b]) > CREATE_SHAPE_TOLERANCE_PT) return false;
  return true;
}

function shapeWithinArtboard(bounds, rect) {
  return bounds[0] >= rect[0] - CREATE_SHAPE_TOLERANCE_PT && bounds[1] <= rect[1] + CREATE_SHAPE_TOLERANCE_PT &&
    bounds[2] <= rect[2] + CREATE_SHAPE_TOLERANCE_PT && bounds[3] >= rect[3] - CREATE_SHAPE_TOLERANCE_PT;
}

function shapeResolveLayer(document, path) {
  var container = document;
  if (!path || typeof path.length !== "number" || path.length < 1 || path.length > CREATE_SHAPE_MAX_LAYER_DEPTH) {
    throw mutationError("preflight_failed", "The requested layer path is invalid.");
  }
  for (var index = 0; index < path.length; index++) {
    var layers = container.layers;
    if (!layers || typeof layers.length !== "number" || typeof path[index] !== "number" || path[index] < 0 ||
        Math.floor(path[index]) !== path[index] || path[index] >= layers.length) {
      throw mutationError("preflight_failed", "The requested layer path does not exist in the bound document.");
    }
    container = layers[path[index]];
  }
  if (!container || String(container.typename) !== "Layer") throw mutationError("preflight_failed", "The requested layer path does not resolve to a layer.");
  return container;
}

function shapeLayerOrder(layer) {
  var order = [];
  for (var index = 0; index < layer.pageItems.length; index++) {
    var uuid = layer.pageItems[index].uuid;
    if (typeof uuid !== "string" || uuid.length === 0) throw mutationError("preflight_failed", "A layer item native UUID is unavailable.");
    order.push(uuid);
  }
  return order;
}

function shapeLayerAncestry(layer) {
  var chain = [];
  var node = layer;
  while (chain.length <= CREATE_SHAPE_MAX_LAYER_DEPTH) {
    if (node === null || node === undefined) throw mutationError("preflight_failed", "Target layer ancestry does not terminate at the document.");
    var typename;
    try { typename = String(node.typename); } catch (typenameError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
    if (typename === "Document") return chain;
    if (typename !== "Layer") throw mutationError("preflight_failed", "Shape creation supports layer ancestry only.");
    if (typeof node.name !== "string" || typeof node.visible !== "boolean" || typeof node.locked !== "boolean") {
      throw mutationError("preflight_failed", "Target layer ancestry state is unavailable.");
    }
    chain.push({ name: node.name, visible: node.visible, locked: node.locked });
    try { node = node.parent; } catch (nextError) { throw mutationError("preflight_failed", "Target layer ancestry is unavailable."); }
  }
  throw mutationError("preflight_failed", "Target layer ancestry exceeds the supported depth.");
}

function shapeArtboardRect(document, artboardIndex) {
  if (typeof artboardIndex !== "number" || Math.floor(artboardIndex) !== artboardIndex || artboardIndex < 0 ||
      !document.artboards || typeof document.artboards.length !== "number" || artboardIndex >= document.artboards.length) {
    throw mutationError("preflight_failed", "The requested artboard does not exist in the bound document.");
  }
  var rect = document.artboards[artboardIndex].artboardRect;
  if (!rect || rect.length !== 4) throw mutationError("preflight_failed", "The requested artboard rectangle is unavailable.");
  var bounds = [mutationFiniteNumber(rect[0], "artboardRect[0]"), mutationFiniteNumber(rect[1], "artboardRect[1]"),
    mutationFiniteNumber(rect[2], "artboardRect[2]"), mutationFiniteNumber(rect[3], "artboardRect[3]")];
  if (!(bounds[0] < bounds[2]) || !(bounds[1] > bounds[3])) throw mutationError("preflight_failed", "The selected artboard has degenerate bounds.");
  return bounds;
}

function shapeFind(document, uuid) {
  if (typeof document.getPageItemFromUuid !== "function") throw mutationError("preflight_failed", "Illustrator native UUID lookup is unavailable.");
  try {
    var item = document.getPageItemFromUuid(uuid);
    return item === null || item === undefined ? null : item;
  } catch (lookupError) {
    var message = lookupError && lookupError.message ? String(lookupError.message) : "";
    if (lookupError && lookupError.name === "Error" && lookupError.number === 1200 && message === "an Illustrator error occurred: 1346458189 ('MRAP')") return null;
    throw lookupError;
  }
}

/** Complete geometry read-back of the created item. */
function shapeReadGeometry(item) {
  if (!item.pathPoints || typeof item.pathPoints.length !== "number" || item.pathPoints.length < 2 ||
      item.pathPoints.length > CREATE_SHAPE_MAX_PATH_POINTS || typeof item.closed !== "boolean") {
    throw mutationError("verify_mismatch", "The created item geometry is unavailable.");
  }
  var anchors = [];
  for (var index = 0; index < item.pathPoints.length; index++) {
    var anchor = item.pathPoints[index].anchor;
    if (!anchor || anchor.length !== 2) throw mutationError("verify_mismatch", "A created path point anchor is unavailable.");
    anchors.push([shapeRound(anchor[0]), shapeRound(anchor[1])]);
  }
  var bounds = item.geometricBounds;
  if (!bounds || bounds.length !== 4) throw mutationError("verify_mismatch", "The created item bounds are unavailable.");
  var geometry = { closed: item.closed, anchors: anchors,
    geometricBounds: [shapeRound(bounds[0]), shapeRound(bounds[1]), shapeRound(bounds[2]), shapeRound(bounds[3])] };
  if (params.shape.kind === "curve") {
    var handles = [];
    for (var hIndex = 0; hIndex < item.pathPoints.length; hIndex++) {
      var hp = item.pathPoints[hIndex];
      if (!hp.leftDirection || hp.leftDirection.length !== 2 || !hp.rightDirection || hp.rightDirection.length !== 2) throw mutationError("verify_mismatch", "A created curve handle is unavailable.");
      var smooth;
      if (hp.pointType === PointType.SMOOTH) smooth = true;
      else if (hp.pointType === PointType.CORNER) smooth = false;
      else throw mutationError("verify_mismatch", "A created curve point type is unavailable.");
      handles.push({ left: [shapeRound(hp.leftDirection[0]), shapeRound(hp.leftDirection[1])], right: [shapeRound(hp.rightDirection[0]), shapeRound(hp.rightDirection[1])], smooth: smooth });
    }
    geometry.handles = handles;
  }
  return geometry;
}

function shapeResolve(forApply) {
  var context = forApply ? requireDocument(params.expectedDocumentKey) : requireDocumentForRead(params.expectedDocumentKey);
  var document = app.activeDocument;
  shapeValidateRequest(params.shape);
  if (params.name !== undefined && (typeof params.name !== "string" || params.name.length > 255)) {
    throw mutationError("preflight_failed", "Shape name must be a string of at most 255 characters.");
  }
  var layer = shapeResolveLayer(document, params.expectedLayerPath);
  var ancestry = shapeLayerAncestry(layer);
  var order = shapeLayerOrder(layer);
  var rect = shapeArtboardRect(document, params.artboardIndex);
  var geometry = shapeDerive(rect, params.shape);
  var defect = shapeDerivedDefect(params.shape.kind, geometry);
  if (defect !== null) throw mutationError("preflight_failed", "The requested shape " + defect + ".");
  var blockers = [];
  if (!context.mutationAllowed) blockers.push("document_mutation_not_allowed");
  var ancestorHidden = false, ancestorLocked = false;
  for (var index = 0; index < ancestry.length; index++) {
    if (!ancestry[index].visible) ancestorHidden = true;
    if (ancestry[index].locked) ancestorLocked = true;
  }
  if (ancestorHidden) blockers.push("layer_hidden");
  if (ancestorLocked) blockers.push("layer_locked");
  if (order.length >= CREATE_SHAPE_MAX_DIRECT_ITEMS) blockers.push("layer_item_capacity_exceeded");
  if (forApply && blockers.length > 0) {
    throw new Error("MCP_ERROR:" + stringifyJson({ code: "CREATE_SHAPE_APPLY_BLOCKED", reasonCodes: blockers, layerPath: params.expectedLayerPath }));
  }
  return { context: context, document: document, layer: layer, ancestry: ancestry, order: order, rect: rect, geometry: geometry, blockers: blockers };
}

function shapePlan(preflight) {
  return {
    operation: "create_shape", documentKey: preflight.context.key, coordinateSpace: "artboard_top_left", unit: "pt",
    artboardIndex: params.artboardIndex, artboardBounds: preflight.rect, shape: params.shape,
    name: params.name === undefined ? null : params.name, geometry: preflight.geometry,
    withinArtboard: shapeWithinArtboard(preflight.geometry.geometricBounds, preflight.rect),
    layer: { path: params.expectedLayerPath, name: preflight.layer.name, visible: preflight.layer.visible, locked: preflight.layer.locked,
      itemUuids: preflight.order, ancestry: preflight.ancestry },
    applyBlockedReasonCodes: preflight.blockers, applyAllowed: preflight.blockers.length === 0
  };
}

function shapeRevalidate(preflight, plan) {
  var current;
  try { current = shapeResolve(true); }
  catch (error) { throw mutationBeforeSideEffectError(mutationPublicMessage(error, "Shape creation preconditions changed before apply.")); }
  if (current.document !== preflight.document || current.layer !== preflight.layer ||
      !mutationSameSequence(current.order, plan.layer.itemUuids) || stringifyJson(current.ancestry) !== stringifyJson(plan.layer.ancestry) ||
      !mutationSameSequence(current.rect, plan.artboardBounds) || !shapeGeometryExact(current.geometry, plan.geometry)) {
    throw mutationBeforeSideEffectError("Shape creation target, layer, or artboard changed before apply.");
  }
}

function shapeApply(preflight, plan, state) {
  state.operationState.mutationStarted = true;
  var shape = params.shape;
  var item;
  if (shape.kind === "ellipse") {
    item = preflight.layer.pathItems.ellipse(plan.geometry.geometricBounds[1], plan.geometry.geometricBounds[0], shape.width, shape.height);
  } else if (shape.kind === "star") {
    item = preflight.layer.pathItems.star(shapeRound(preflight.rect[0] + shape.centerX), shapeRound(preflight.rect[1] - shape.centerY), shape.outerRadius, shape.innerRadius, shape.points);
  } else if (shape.kind === "curve") {
    item = preflight.layer.pathItems.add();
    state.operationState.createdObject = item;
    state.operationState.createdUuid = String(item.uuid);
    item.setEntirePath(plan.geometry.anchors);
    // Measured: handles and point types read back exactly regardless of assignment order.
    for (var pIndex = 0; pIndex < plan.geometry.handles.length; pIndex++) {
      var pathPoint = item.pathPoints[pIndex];
      pathPoint.leftDirection = plan.geometry.handles[pIndex].left;
      pathPoint.rightDirection = plan.geometry.handles[pIndex].right;
      pathPoint.pointType = plan.geometry.handles[pIndex].smooth ? PointType.SMOOTH : PointType.CORNER;
    }
    item.closed = plan.geometry.closed;
  } else if (shape.kind === "polygon") {
    item = preflight.layer.pathItems.polygon(shapeRound(preflight.rect[0] + shape.centerX), shapeRound(preflight.rect[1] - shape.centerY), shape.radius, shape.sides);
  } else {
    item = preflight.layer.pathItems.add();
    state.operationState.createdObject = item;
    state.operationState.createdUuid = String(item.uuid);
    item.setEntirePath(plan.geometry.anchors);
    item.closed = plan.geometry.closed;
  }
  state.operationState.createdObject = item;
  if (typeof item.uuid !== "string" || item.uuid.length === 0) throw mutationError("apply_failed", "Illustrator did not return a valid native UUID.");
  state.operationState.createdUuid = String(item.uuid);
  if (params.name !== undefined) item.name = params.name;
  return item;
}

function shapeVerify(preflight, plan, state) {
  if (app.documents.length === 0 || app.activeDocument !== preflight.document) throw mutationError("verify_mismatch", "Active document changed during shape verification.");
  var createdUuid = state.operationState.createdUuid;
  if (typeof createdUuid !== "string" || createdUuid.length === 0) throw mutationError("verify_mismatch", "The created shape has no captured native UUID.");
  var item = shapeFind(preflight.document, createdUuid);
  if (item === null || item !== state.operationState.createdObject) throw mutationError("verify_mismatch", "The created native UUID does not resolve to the created shape.");
  if (String(item.typename) !== "PathItem" || item.layer !== preflight.layer) throw mutationError("verify_mismatch", "The created shape has an unexpected type or layer.");
  if (typeof item.locked !== "boolean" || typeof item.hidden !== "boolean" || typeof item.editable !== "boolean" || item.locked || item.hidden || !item.editable) {
    throw mutationError("verify_mismatch", "The created shape is not verifiably editable.");
  }
  var order = shapeLayerOrder(preflight.layer);
  if (order.length !== plan.layer.itemUuids.length + 1 || order[0] !== createdUuid || !mutationSameSequence(order.slice(1), plan.layer.itemUuids)) {
    throw mutationError("verify_mismatch", "The created shape is not the only new front item of its layer.");
  }
  var geometry = shapeReadGeometry(item);
  if (!shapeGeometryMatches(geometry, plan.geometry)) throw mutationError("verify_mismatch", "The created shape geometry does not match the plan.");
  if (params.name !== undefined && item.name !== params.name) throw mutationError("verify_mismatch", "The created shape name does not match the plan.");
  return { uuid: createdUuid, type: "PathItem", name: item.name || "", geometry: geometry, layerItemUuids: order };
}

function shapeRollback(state) {
  var preflight = state.preflight;
  var createdUuid = state.operationState.createdUuid;
  if (!preflight || app.documents.length === 0 || app.activeDocument !== preflight.document) {
    return { status: "indeterminate", message: "Rollback document identity is indeterminate." };
  }
  if (typeof createdUuid !== "string" || createdUuid.length === 0) {
    // A creation was attempted but no native UUID was captured: the recovery cannot name what it undid.
    return { status: "indeterminate", message: "Rollback cannot identify the created item." };
  }
  state.operationState.rollbackEvidence.createdUuid = createdUuid;
  var item;
  try { item = shapeFind(preflight.document, createdUuid); } catch (findError) { return { status: "indeterminate", message: "Rollback target identity is indeterminate." }; }
  if (item === null) {
    var absentOrder;
    try { absentOrder = shapeLayerOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
    if (!mutationSameSequence(absentOrder, preflight.order)) return { status: "indeterminate", message: "Rollback refused because the layer no longer matches the baseline." };
    state.operationState.rollbackEvidence.restoredItemUuids = absentOrder;
    return { status: "verified" };
  }
  var currentOrder;
  try { currentOrder = shapeLayerOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback layer order is indeterminate." }; }
  if (currentOrder.length !== preflight.order.length + 1 || currentOrder[0] !== createdUuid || !mutationSameSequence(currentOrder.slice(1), preflight.order)) {
    return { status: "indeterminate", message: "Rollback refused because the layer is neither the baseline nor the created state." };
  }
  try { item.remove(); } catch (removeError) { return { status: "indeterminate", message: "Rollback removal is indeterminate." }; }
  var restored;
  try { restored = shapeLayerOrder(preflight.layer); } catch (e) { return { status: "indeterminate", message: "Rollback verification is indeterminate." }; }
  state.operationState.rollbackEvidence.restoredItemUuids = restored;
  var stillPresent;
  try { stillPresent = shapeFind(preflight.document, createdUuid) !== null; } catch (e) { return { status: "indeterminate", message: "Rollback absence lookup is indeterminate." }; }
  if (stillPresent) return { status: "failed", message: "Rollback did not remove the created native UUID." };
  // The item is gone but the layer is not the baseline: something else moved, which this rollback cannot name.
  return mutationSameSequence(restored, preflight.order) ? { status: "verified" } : { status: "indeterminate", message: "Rollback removed the created item but the layer does not match the baseline." };
}

var shapeExecution = runMutationTransaction({
  apply: params.apply === true,
  editSessionLayers: function (phase, preflight) { return [preflight.layer]; },
  // the items this change reads and writes, so an edit session can advance its item aggregate.
  editSessionAffected: function (phase, preflight, plan, state) { return phase === "after" ? [state.operationState.createdUuid] : []; },
  initialOperationState: function () { return { mutationStarted: false, createdObject: null, createdUuid: null, rollbackEvidence: { createdUuid: null, restoredItemUuids: null } }; },
  preflight: shapeResolve,
  plan: shapePlan,
  revalidate: shapeRevalidate,
  applyMutation: shapeApply,
  verify: shapeVerify,
  rollback: shapeRollback,
  hasMutationEvidence: function (state) { return state.operationState.mutationStarted === true; },
  applyIndeterminate: function () { return { reasonCode: "created_state_unknown", message: "Shape creation outcome is indeterminate.", evidence: { createdUuid: null, restoredItemUuids: null } }; },
  rollbackEvidence: function (state) { return state.operationState.rollbackEvidence; }
});

var shapeDocument = shapeExecution.preflight.context;
if (app.documents.length > 0 && app.activeDocument === shapeExecution.preflight.document) shapeDocument = getDocumentContext();
var result = { operation: "create_shape", applied: shapeExecution.transaction.state === "verified",
  document: shapeDocument, plan: shapeExecution.plan, transaction: shapeExecution.transaction };
if (shapeExecution.transaction.state === "verified") result.created = shapeExecution.value;
`;
export const CREATE_SHAPE_HOST_SCRIPT_DIGEST = canonicalSha256(CREATE_SHAPE_SCRIPT);
export const CREATE_SHAPE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: CREATE_SHAPE_OPERATION, validator: CREATE_SHAPE_VALIDATOR,
    canonicalContractVersion: CANONICAL_VERSION, resultSchemaVersion: RESULT_SCHEMA_VERSION, terminalClassifierVersion: CLASSIFIER_VERSION,
    safetyConformanceVersion: CONFORMANCE_VERSION, errorMappingVersion: ERROR_MAPPING_VERSION,
    safetyIdentity: CREATE_SHAPE_SAFETY_IDENTITY, hostScriptDigest: CREATE_SHAPE_HOST_SCRIPT_DIGEST,
});
function normalizedRequest(input) {
    const request = internalInputSchema.parse(input);
    const digestRequest = 'commandId' in request ? (({ commandId: _commandId, ...rest }) => rest)(request) : request;
    const digest = canonicalSha256({ operation: CREATE_SHAPE_OPERATION, validator: CREATE_SHAPE_VALIDATOR, request: digestRequest });
    return { intent: request.apply ? 'apply' : 'plan', request, commandId: 'commandId' in request ? request.commandId : null,
        documentKey: request.expectedDocumentKey, digest };
}
export const createShapeToolContract = {
    name: 'illustrator_create_shape',
    title: 'Plan or Create Shape',
    description: `Plan or create one ellipse, regular polygon (${CREATE_SHAPE_MIN_POLYGON_SIDES}-${CREATE_SHAPE_MAX_POLYGON_SIDES} sides), star (${CREATE_SHAPE_MIN_STAR_POINTS}-${CREATE_SHAPE_MAX_STAR_POINTS} points, outer radius larger than inner), straight line, straight-segment path, or curve with explicit direction handles and smooth/corner point types (2-${CREATE_SHAPE_MAX_PATH_POINTS} points, open or closed) on an explicit layer path in artboard-top-left points. Degenerate shapes (zero size, coincident consecutive points or star vertices, closed curves that enclose no area) and self-intersecting straight paths are rejected before any write; curve self-intersection is not checked. Apply creates once, verifies the native UUID, layer order, closed state, anchors, handles, point types and bounds against the plan, and rolls back only its own created item with absence proven.`,
    inputSchema,
    publicInputSchema: createShapePublicInputSchema,
    outputSchema: createShapeResponseSchema,
    annotations: operationSafetyPolicyToMcpAnnotations(CREATE_SHAPE_SAFETY.policy),
    normalizePublicInput,
};
export function createShapeAdapter() {
    return {
        version: 1, operation: CREATE_SHAPE_OPERATION, validator: CREATE_SHAPE_VALIDATOR,
        safety: CREATE_SHAPE_SAFETY, safetyRegistrationIdentity: CREATE_SHAPE_SAFETY_IDENTITY,
        adapterIdentity: CREATE_SHAPE_ADAPTER_IDENTITY, tool: createShapeToolContract,
        canonical: { version: CANONICAL_VERSION, normalize: normalizedRequest, safetyDigest: (input) => normalizedRequest(input).digest },
        resultSchema: createShapeResultSchema, resultSchemaVersion: RESULT_SCHEMA_VERSION,
        terminalClassifierVersion: CLASSIFIER_VERSION, safetyConformanceVersion: CONFORMANCE_VERSION,
        errorMappingVersion: ERROR_MAPPING_VERSION, hostScriptDigest: CREATE_SHAPE_HOST_SCRIPT_DIGEST,
        buildCommand(input) {
            const normalized = normalizedRequest(input);
            const { commandId: _commandId, ...params } = normalized.request;
            if (normalized.intent === 'plan')
                return { kind: 'read', script: CREATE_SHAPE_SCRIPT, params };
            return { kind: 'mutation', mutationValidator: CREATE_SHAPE_VALIDATOR,
                idempotency: { commandId: normalized.commandId, operation: CREATE_SHAPE_OPERATION, documentKey: normalized.documentKey, requestDigest: normalized.digest },
                adapterIdentity: CREATE_SHAPE_ADAPTER_IDENTITY, script: CREATE_SHAPE_SCRIPT, params };
        },
        classifyTerminal(value) {
            const state = createShapeResultSchema.parse(value).transaction.state;
            if (state === 'verified' || state === 'apply_failed' || state === 'rolled_back' || state === 'rollback_failed')
                return { state };
            if (state === 'planned')
                throw new Error('Shape creation plan is not a terminal mutation result.');
            throw new Error('Indeterminate shape creation must retain its lock.');
        },
        assertSafetyConformance: assertSafety,
        mapExecutionError(error, detail) {
            if (detail?.code === 'CREATE_SHAPE_APPLY_BLOCKED') {
                return new Error(`Shape creation is blocked: ${(detail.reasonCodes ?? []).join(', ') || 'unknown reason'}.`);
            }
            return error instanceof Error ? error : new Error(String(error));
        },
    };
}
