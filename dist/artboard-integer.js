export const ARTBOARD_INTEGER_TOLERANCE = 1e-6;
export const isIntegerWithinTolerance = (value) => Number.isFinite(value) && Math.abs(value - Math.round(value)) <= ARTBOARD_INTEGER_TOLERANCE;
export const readIntegerWithinTolerance = (value) => isIntegerWithinTolerance(value) ? Math.round(value) + 0 : value;
export const artboardRectsEqual = (left, right) => {
    if (left === right)
        return true;
    const leftBoards = left.split(';');
    const rightBoards = right.split(';');
    if (leftBoards.length !== rightBoards.length)
        return false;
    return leftBoards.every((board, index) => {
        const a = board.split(',');
        const b = rightBoards[index].split(',');
        return a.length === 4 && b.length === 4 && a.every((edge, edgeIndex) => Math.abs(Number(edge) - Number(b[edgeIndex])) <= ARTBOARD_INTEGER_TOLERANCE);
    });
};
