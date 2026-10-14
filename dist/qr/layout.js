export function qrDarkRuns(matrix) {
    const runs = [];
    matrix.rows.forEach((row, y) => {
        let start = -1;
        for (let x = 0; x <= row.length; x += 1) {
            const dark = x < row.length && row[x] === true;
            if (dark && start < 0)
                start = x;
            if (!dark && start >= 0) {
                runs.push({ x: start, y, width: x - start });
                start = -1;
            }
        }
    });
    return runs;
}
export function qrDarkModuleCount(matrix) {
    return matrix.rows.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}
export function qrGeometry(matrix, sizePt, quietZoneModules) {
    const totalModules = matrix.modules + 2 * quietZoneModules;
    return { sizePt, quietZoneModules, modules: matrix.modules, totalModules, modulePt: sizePt / totalModules };
}
export function qrRunRect(geometry, run, originX, originY) {
    return {
        x: originX + (geometry.quietZoneModules + run.x) * geometry.modulePt,
        y: originY + (geometry.quietZoneModules + run.y) * geometry.modulePt,
        width: run.width * geometry.modulePt,
        height: geometry.modulePt,
    };
}
