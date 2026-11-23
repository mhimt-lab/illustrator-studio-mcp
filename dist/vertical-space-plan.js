const finite = (rect) => rect.every(Number.isFinite) && rect[0] <= rect[2] && rect[1] >= rect[3];
export function classifyItem(box, frame) {
    if (!finite(box))
        throw new Error('Invalid Illustrator box.');
    const [l, t, r, b] = box, [minX, maxX] = frame.xRange;
    if (r <= minX || l >= maxX)
        return 'untouched';
    const inside = l >= minX && r <= maxX;
    if (t <= frame.cutY)
        return inside ? 'moved' : 'crosses_x_range';
    if (b >= frame.cutY)
        return 'untouched';
    return inside ? 'crosses_cut' : 'crosses_x_range';
}
export function classifyGuide(box, frame) {
    const item = classifyItem(box, frame);
    if (item === 'moved')
        return 'move';
    if (item === 'crosses_cut')
        return 'stretch';
    return item;
}
export function classifyBoard(rect, frame) {
    const [l, t, r, b] = rect, [minX, maxX] = frame.xRange;
    if (l < minX || r > maxX)
        return (r <= minX || l >= maxX) ? 'not_affected' : 'crosses_x_range';
    if (t <= frame.cutY)
        return 'move';
    if (b < frame.cutY)
        return 'stretch';
    return 'not_affected';
}
export const moveRect = (r, dy) => [r[0], r[1] + dy, r[2], r[3] + dy];
export const stretchRect = (r, dy) => [r[0], r[1], r[2], r[3] + dy];
export function guidePointsAfter(geometry, mode, cutY, dy) {
    const points = geometry.points.map((p) => ((mode === 'move' || p[1] < cutY) ? [p[0], p[1] + dy, p[2], p[3] + dy, p[4], p[5] + dy] : [...p]));
    const shift = (b) => (mode === 'move' ? [b[0], b[1] + dy, b[2], b[3] + dy] : [b[0], b[1], b[2], b[3] + dy]);
    return { points, geometricBounds: shift(geometry.geometricBounds), visibleBounds: shift(geometry.visibleBounds), controlBounds: shift(geometry.controlBounds),
        position: (mode === 'move' ? [geometry.position[0], geometry.position[1] + dy] : [...geometry.position]) };
}
