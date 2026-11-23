const HOST_PATH_FORMS_LIMIT = 64;
export function hostPathForms(path) {
    const components = path.split('/').map((component) => [...new Set([component, component.normalize('NFC'), component.normalize('NFD')])]);
    let forms = [''];
    let overCap = false;
    for (const [index, candidates] of components.entries()) {
        const next = [];
        for (const prefix of forms)
            for (const candidate of candidates)
                next.push(index === 0 ? candidate : `${prefix}/${candidate}`);
        if (next.length > HOST_PATH_FORMS_LIMIT) {
            overCap = true;
            break;
        }
        forms = next;
    }
    if (overCap)
        forms = [path, path.normalize('NFC'), path.normalize('NFD')];
    return [...new Set(forms)];
}
export function sameFilePath(left, right) {
    return left.normalize('NFC') === right.normalize('NFC');
}
export function documentKeyPath(key) {
    if (typeof key !== 'string')
        return null;
    const match = /^v1\|path=([^|]*)\|name=[^|]*\|index=-?\d+\|saved=(?:true|false)\|revision=[^|]*\|artboards=[^|]*$/u.exec(key);
    if (match === null || match[1] === '')
        return null;
    const path = decodeURIComponent(match[1]);
    return path.startsWith('/') ? path : null;
}
export function pathComparisonParams(params) {
    const { hostFilePathForms: _untrusted, hostFilePathComponents: _untrustedComponents, hostDocumentPathBindings: _untrustedBindings, ...raw } = params;
    const forms = Object.create(null);
    const components = Object.create(null);
    const bindings = Object.create(null);
    const keys = [...new Set([raw.expectedDocumentKey, raw.confirmDocumentKey])].flatMap((key) => {
        const path = documentKeyPath(key);
        return path === null ? [] : [{ path, key: key }];
    });
    function collect(value, key) {
        if (typeof value === 'string' && (key === 'path' || /Paths?$/u.test(key)) && value.startsWith('/')) {
            const candidates = hostPathForms(value);
            const bound = keys.filter((binding) => sameFilePath(value, binding.path) && !candidates.includes(binding.path));
            if (bound.length > 0)
                bindings[value] = bound;
            if (candidates.length > 1) {
                forms[value] = candidates;
                components[value] = value.split('/').map((part) => [...new Set([part, part.normalize('NFC'), part.normalize('NFD')])]);
            }
        }
        else if (Array.isArray(value)) {
            for (const item of value)
                collect(item, key);
        }
        else if (value !== null && typeof value === 'object') {
            for (const [childKey, child] of Object.entries(value))
                collect(child, childKey);
        }
    }
    collect(raw, '');
    return { ...raw,
        ...(Object.keys(forms).length === 0 ? {} : { hostFilePathForms: forms, hostFilePathComponents: components }),
        ...(Object.keys(bindings).length === 0 ? {} : { hostDocumentPathBindings: bindings }),
    };
}
export const HOST_FILE_PATH_HELPERS = `
function hostFilePathMatches(actual, expected) {
  if (actual === expected) return true;
  var forms = params.hostFilePathForms;
  if (!forms || !Object.prototype.hasOwnProperty.call(forms, expected)) return false;
  var candidates = forms[expected];
  for (var pathFormIndex = 0; pathFormIndex < candidates.length; pathFormIndex++) {
    if (actual === candidates[pathFormIndex]) return true;
  }
  return false;
}
/** A full key admits an otherwise missed spelling only under its exact current Host identity. */
function hostDocumentPathMatches(actual, expected, actualKey) {
  if (hostFilePathMatches(actual, expected)) return true;
  var all = params.hostDocumentPathBindings;
  if (!all || !Object.prototype.hasOwnProperty.call(all, expected)) return false;
  var bindings = all[expected];
  for (var bindingIndex = 0; bindingIndex < bindings.length; bindingIndex++) {
    if (actual === bindings[bindingIndex].path && actualKey === bindings[bindingIndex].key) return true;
  }
  return false;
}
/** Only detects a possible missed alias to REFUSE an action; never admits a positive match. */
function hostFilePathMissMayMatch(actual, expected) {
  var all = params.hostFilePathComponents;
  if (typeof actual !== "string" || !all || !Object.prototype.hasOwnProperty.call(all, expected)) return false;
  var parts = actual.split("/");
  var candidates = all[expected];
  if (parts.length !== candidates.length) return false;
  for (var partIndex = 0; partIndex < parts.length; partIndex++) {
    var found = false;
    for (var candidateIndex = 0; candidateIndex < candidates[partIndex].length; candidateIndex++) {
      if (parts[partIndex] === candidates[partIndex][candidateIndex]) found = true;
    }
    if (!found) return false;
  }
  return true;
}
`;
export const PATH_CONTAINS_PERCENT = 'path_contains_percent';
const PATH_FIELD_NAME = /(?:^|_)(?:path|paths|dir|directory|file|files|folder|root)$|[a-z](?:Path|Paths|Dir|Directory|File|Files|Folder|Root)$/u;
const PERCENT_ESCAPE = /%(?:[0-9A-Fa-f]{2}|[uU][0-9A-Fa-f]{4})/u;
export function pathContainsPercentEscape(path) {
    return PERCENT_ESCAPE.test(path);
}
export function percentPathFields(params, prefix = '') {
    if (Array.isArray(params))
        return params.flatMap((item, index) => (typeof item === 'string'
            ? (PATH_FIELD_NAME.test(prefix.slice(prefix.lastIndexOf('.') + 1)) && pathContainsPercentEscape(item) ? [`${prefix}[${index}]`] : [])
            : percentPathFields(item, `${prefix}[${index}]`)));
    if (params === null || typeof params !== 'object')
        return [];
    return Object.entries(params).flatMap(([key, value]) => {
        const name = prefix === '' ? key : `${prefix}.${key}`;
        if (typeof value === 'string')
            return PATH_FIELD_NAME.test(key) && pathContainsPercentEscape(value) ? [name] : [];
        return percentPathFields(value, name);
    });
}
export const PATH_CONTAINS_PERCENT_MESSAGE = "A path that contains '%' followed by two hex digits (such as %20 or %E3%81%82) (or '%u' and four) is refused, and nothing was sent to Illustrator: ExtendScript reads a path as a URI, "
    + "so the escape becomes another character and the file is written to a different folder (measured on Illustrator 30.8.2, #848). A '%' that is not followed by two hex digits (50%off, 100%.ai) is accepted. "
    + "Give a path whose folders and file name have no '%' plus two hex digits (rename or move the file). "
    + "/ パスに '%' と 16 進 2 桁（%20、%E3%81%82 など）が続く部分があるため拒否しました（Illustrator には何も送っていません）。ExtendScript はパスを URI として読むので、その部分が別の文字に変わり、別のフォルダに書き込まれます。"
    + "'%u' と 16 進 4 桁（%u3042 など）も同様です。'%' の後が 16 進 2 桁でない名前（50%off、100%.ai など）は受け付けます。フォルダ名・ファイル名から '%' と 16 進 2 桁の並びを除いたパスを指定してください（名前を変えるか、移動してから）。";
