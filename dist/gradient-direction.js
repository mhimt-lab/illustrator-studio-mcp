export const GRADIENT_SIDES = ['right', 'top-right', 'top', 'top-left', 'left', 'bottom-left', 'bottom', 'bottom-right'];
export function gradientStop0Side(angle) {
    if (!Number.isFinite(angle))
        throw new Error('Gradient angle must be finite.');
    const opposite = (((angle + 180) % 360) + 360) % 360;
    return GRADIENT_SIDES[Math.round(opposite / 45) % 8];
}
export function gradientStop100Side(angle) {
    if (!Number.isFinite(angle))
        throw new Error('Gradient angle must be finite.');
    const forward = ((angle % 360) + 360) % 360;
    return GRADIENT_SIDES[Math.round(forward / 45) % 8];
}
export const GRADIENT_DIRECTION_SCRIPT = `
var APPEARANCE_GRADIENT_SIDES = ["right", "top-right", "top", "top-left", "left", "bottom-left", "bottom", "bottom-right"];

function appearanceGradientSide(degrees) {
  var turned = ((degrees % 360) + 360) % 360;
  return APPEARANCE_GRADIENT_SIDES[Math.round(turned / 45) % 8];
}

function appearanceGradientStop0Side(angle) {
  return appearanceGradientSide(angle + 180);
}

function appearanceGradientStop100Side(angle) {
  return appearanceGradientSide(angle);
}
`;
