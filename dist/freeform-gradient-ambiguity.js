export const FREEFORM_GRAY0_NOTE = 'A fill that reads as gray 0 may be a freeform gradient: the DOM reports both as the same GrayColor 0 and nothing else in a read tells them apart. Check the artwork before relying on these fills.';
export function isPossibleFreeformFill(item) {
    if (item.type === 'TextFrame')
        return false;
    const fill = item.appearance.fill;
    return fill.status === 'available' && fill.value.model === 'gray' && fill.value.gray === 0;
}
export function countPossibleFreeformFills(items) {
    let count = 0;
    for (const item of items)
        if (isPossibleFreeformFill(item))
            count += 1;
    return count;
}
export function freeformGradientFields(count) {
    return { possible_freeform_gradient_fills: count, possible_freeform_gradient_note: count > 0 ? FREEFORM_GRAY0_NOTE : null };
}
export const FREEFORM_GRAY0_HOST_PREDICATE = `function appearanceFreeformGray0(fill) {
  return !!fill && fill.kind === "solid" && !!fill.color && fill.color.model === "gray" && fill.color.gray === 0;
}`;
export const FREEFORM_FILL_CHANGE_REFUSAL = 'fill_may_be_freeform_gradient: ' + FREEFORM_GRAY0_NOTE +
    ' This request changes that fill, which could replace a freeform gradient with a solid color that the inverse cannot restore.' +
    ' Send the current fill unchanged to change only opacity or stroke, or set fill.confirm_gray0_fill_is_solid to true once the artwork is checked.';
