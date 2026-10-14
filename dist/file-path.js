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
