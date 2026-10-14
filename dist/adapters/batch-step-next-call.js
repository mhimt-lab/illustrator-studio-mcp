import { isDeepStrictEqual } from 'node:util';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const REPLACE_POINT_TEXT_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => request.replacement === plan.replacement,
});
export const SET_TEXT_STYLE_BATCH_STYLE_FIELDS = Object.freeze({
    size: 'size',
    tracking: 'tracking',
    horizontal_scale: 'horizontalScale',
    vertical_scale: 'verticalScale',
    fill_color: 'fillColor',
});
export function batchTextStyleInternal(style) {
    const keys = Object.keys(style);
    if (keys.length !== 1 || !Object.hasOwn(SET_TEXT_STYLE_BATCH_STYLE_FIELDS, keys[0]))
        return null;
    const key = keys[0];
    const value = style[key];
    if (key === 'fill_color')
        return isRecord(value) ? { fillColor: { model: 'rgb', ...value } } : null;
    return { [SET_TEXT_STYLE_BATCH_STYLE_FIELDS[key]]: value };
}
export const SET_TEXT_STYLE_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => {
        if (!isRecord(request.style))
            return false;
        const style = batchTextStyleInternal(request.style);
        return style !== null && request.start === plan.start && request.end === plan.end && isDeepStrictEqual(style, plan.style);
    },
});
export const TRANSFORM_OBJECT_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => isRecord(request.transform) &&
        isDeepStrictEqual({ type: request.transform.type, deltaX: request.transform.delta_x, deltaY: request.transform.delta_y }, plan.transform),
});
export const SET_PATH_APPEARANCE_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => {
        if (!isRecord(request.appearance) || !isRecord(plan.after))
            return false;
        const { fill, stroke, opacity } = plan.after;
        if (!isRecord(fill) || !isRecord(stroke))
            return false;
        return plan.targetUuid === request.target_uuid && isDeepStrictEqual(request.appearance, {
            opacity,
            fill: fill.kind === 'none' ? { kind: 'none' } : fill,
            stroke: stroke.kind === 'none' ? { kind: 'none' } : stroke,
        });
    },
});
export const SET_OBJECT_STATE_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => request.target_type === plan.targetType && isDeepStrictEqual(request.after, plan.requested),
});
export const SET_LAYER_STATE_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => isDeepStrictEqual(request.layer_path, plan.layerPath) && isDeepStrictEqual(request.after, plan.requested),
});
export const MOVE_OBJECT_TO_LAYER_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => isRecord(plan.destinationLayer) &&
        isDeepStrictEqual(request.destination_layer_path, plan.destinationLayer.path) && request.placement === plan.placement,
    extraEcho: (plan) => ({ expected_source_order: plan.sourceOrderBefore, expected_destination_order: plan.destinationOrderBefore }),
});
export const APPLY_CHARACTER_STYLE_BATCH_NEXT_CALL = Object.freeze({
    matchesPlan: (request, plan) => request.start === plan.start && request.end === plan.end && request.style_name === plan.styleName,
    extraEcho: (plan) => ({ expected_style: plan.style }),
});
export const BATCH_STEP_NEXT_CALLS = Object.freeze({
    replace_point_text: REPLACE_POINT_TEXT_BATCH_NEXT_CALL,
    set_text_style: SET_TEXT_STYLE_BATCH_NEXT_CALL,
    transform_object: TRANSFORM_OBJECT_BATCH_NEXT_CALL,
    set_path_appearance: SET_PATH_APPEARANCE_BATCH_NEXT_CALL,
    set_object_state: SET_OBJECT_STATE_BATCH_NEXT_CALL,
    set_layer_state: SET_LAYER_STATE_BATCH_NEXT_CALL,
    move_object_to_layer: MOVE_OBJECT_TO_LAYER_BATCH_NEXT_CALL,
    apply_character_style: APPLY_CHARACTER_STYLE_BATCH_NEXT_CALL,
});
