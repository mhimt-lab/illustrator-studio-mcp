const RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*]/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f]/u;
export function windowsPathComponentRejection(component) {
    if (component === '')
        return 'empty_component';
    if (component === '.' || component === '..')
        return 'dot_component';
    if (CONTROL_CHARACTERS.test(component))
        return 'control_character';
    if (FORBIDDEN_CHARACTERS.test(component))
        return 'forbidden_character';
    if (component.endsWith(' ') || component.endsWith('.'))
        return 'trailing_space_or_dot';
    const stem = component.split('.')[0].replace(/ +$/u, '').toUpperCase();
    if (RESERVED_NAMES.has(stem))
        return 'reserved_name';
    return null;
}
export function validateWindowsOutputPath(path) {
    if (path === '')
        return { ok: false, reason: 'empty' };
    if (path.startsWith('\\\\') || path.startsWith('//'))
        return { ok: false, reason: 'unc_or_device' };
    if (path.startsWith('\\') || path.startsWith('/'))
        return { ok: false, reason: 'root_relative' };
    if (/^[A-Za-z]:(?![\\/])/u.test(path))
        return { ok: false, reason: 'drive_relative' };
    if (!/^[A-Za-z]:\\/u.test(path))
        return { ok: false, reason: 'not_drive_absolute' };
    const components = path.slice(3).split('\\');
    if (components.length === 1 && components[0] === '')
        return { ok: false, reason: 'no_file_name' };
    for (const component of components) {
        const reason = windowsPathComponentRejection(component);
        if (reason !== null)
            return { ok: false, reason, component };
    }
    return { ok: true };
}
