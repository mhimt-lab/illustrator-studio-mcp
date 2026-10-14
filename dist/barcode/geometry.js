export function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}
export function cubicAt(p0, c1, c2, p1, t) {
    const u = 1 - t;
    return [
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ];
}
export function flattenContour(points, steps = 12) {
    const polygon = [];
    for (let index = 0; index < points.length; index += 1) {
        const from = points[index];
        const to = points[(index + 1) % points.length];
        polygon.push(from.anchor);
        const straight = from.right[0] === from.anchor[0] && from.right[1] === from.anchor[1] && to.left[0] === to.anchor[0] && to.left[1] === to.anchor[1];
        if (!straight)
            for (let step = 1; step < steps; step += 1)
                polygon.push(cubicAt(from.anchor, from.right, to.left, to.anchor, step / steps));
    }
    return polygon;
}
