import { z } from 'zod';
export const TRIM_VIEW_GUIDE_LAYER_NAME = 'Guides Preview for Trim View';
export const NON_PRINTING_LAYER_LIMIT = 20;
export const nonPrintingLayerSchema = z.object({
    path: z.array(z.number().int().nonnegative()).describe('Layer index path from the top (0 = first layer, then sublayer indexes).'),
    name: z.string(),
    items: z.number().int().nonnegative().describe('Page items directly in the layer.'),
    trimViewGuide: z.boolean().describe(`True when the name is "${TRIM_VIEW_GUIDE_LAYER_NAME}" (a leading * and edge spaces ignored), printable or not.`),
});
export const nonPrintingLayerWarningSchema = z.object({
    code: z.enum(['visible_non_printing_layers', 'non_printing_layers_excluded', 'non_printing_layer_scan_unavailable']),
    message: z.string(),
    layers: z.array(nonPrintingLayerSchema).max(NON_PRINTING_LAYER_LIMIT),
    truncated: z.boolean(),
});
export const EXCLUDE_NON_PRINTING_LAYERS_DESCRIPTION = 'Hide visible non-printing layers (and the Trim View guide layer) in the private work copy before exporting; the document is never changed. Default: they are drawn, as Illustrator does.';
const layerLabel = (layer) => `"${layer.name}" (path ${layer.path.join('.')}, ${layer.items} item${layer.items === 1 ? '' : 's'}${layer.trimViewGuide ? ', Trim View guide' : ''})`;
export function nonPrintingLayerWarning(scan, how) {
    if (scan === undefined)
        return null;
    if (scan.unavailable === true) {
        return { code: 'non_printing_layer_scan_unavailable', truncated: false, layers: [],
            message: 'Visible non-printing layers could not be checked (the layer read failed); the result is otherwise unaffected. A non-printing layer, if any, appears in PNG, JPEG and preview images.' };
    }
    if (scan.layers.length === 0)
        return null;
    const names = scan.layers.map(layerLabel).join('; ') + (scan.truncated ? '; more' : '');
    if (how === 'excluded') {
        return { code: 'non_printing_layers_excluded', truncated: scan.truncated, layers: scan.layers,
            message: `Hidden in the export's private work copy only: ${names}. The document is unchanged.` };
    }
    const advice = how === 'warn_with_option' ? ' Pass exclude_non_printing_layers: true to leave them out of this export.' : '';
    const group = (layers) => layers.map(layerLabel).join('; ');
    const topLevel = scan.layers.filter((layer) => layer.path.length === 1 && !layer.trimViewGuide);
    const sublayers = scan.layers.filter((layer) => layer.path.length > 1);
    const guides = scan.layers.filter((layer) => layer.path.length === 1 && layer.trimViewGuide);
    const parts = [];
    if (topLevel.length > 0)
        parts.push(`Left out of PDF (top-level, non-printing): ${group(topLevel)}.`);
    if (sublayers.length > 0)
        parts.push(`Also drawn into PDF (a sublayer's printable=false has no effect on PDF): ${group(sublayers)}.`);
    if (guides.length > 0)
        parts.push(`Trim View guide layer, in PDF only if it is printable: ${group(guides)}.`);
    if (scan.truncated)
        parts.push('More layers are not listed.');
    return { code: 'visible_non_printing_layers', truncated: scan.truncated, layers: scan.layers,
        message: `A visible non-printing layer appears in PNG, JPEG and preview images (measured on Illustrator 30.8.2). ${parts.join(' ')}${advice}` };
}
export const NON_PRINTING_LAYER_HELPERS = String.raw `
var NPL_GUIDE_NAME = ${JSON.stringify(TRIM_VIEW_GUIDE_LAYER_NAME)};
var NPL_LIMIT = ${NON_PRINTING_LAYER_LIMIT};
function nplPlain(name) {
  var text = String(name), start = 0, end = text.length;
  while (start < text.length && (text.charAt(start) === "*" || text.charAt(start) === " ")) start++;
  while (end > start && text.charAt(end - 1) === " ") end--;
  return text.substring(start, end);
}
function nplWalk(collection, parentPath, hide, scan) {
  for (var nplIndex = 0; nplIndex < collection.length; nplIndex++) {
    var nplLayer = collection[nplIndex];
    if (nplLayer.visible !== true) continue;
    var nplGuide = nplPlain(nplLayer.name) === NPL_GUIDE_NAME;
    if (nplLayer.printable !== true || nplGuide) {
      var nplItems = nplLayer.pageItems.length;
      if (nplItems > 0 || nplLayer.layers.length > 0) {
        if (scan.layers.length < NPL_LIMIT) scan.layers.push({ path: parentPath.concat([nplIndex]), name: String(nplLayer.name), items: nplItems, trimViewGuide: nplGuide });
        else scan.truncated = true;
        if (hide) nplLayer.visible = false;
      }
      continue;
    }
    nplWalk(nplLayer.layers, parentPath.concat([nplIndex]), hide, scan);
  }
}
/** Every layer named like the Trim View guide layer, hidden or not (a read-only listing for preflight). */
function nplGuides(nplDocument) {
  var guides = [];
  nplFindGuides(nplDocument.layers, [], guides);
  return guides;
}
function nplFindGuides(collection, parentPath, guides) {
  for (var nplGuideIndex = 0; nplGuideIndex < collection.length; nplGuideIndex++) {
    var nplCandidate = collection[nplGuideIndex];
    if (nplPlain(nplCandidate.name) === NPL_GUIDE_NAME && guides.length < NPL_LIMIT) {
      guides.push({ path: parentPath.concat([nplGuideIndex]), name: String(nplCandidate.name), items: nplCandidate.pageItems.length,
        visible: nplCandidate.visible === true, printable: nplCandidate.printable === true });
    }
    nplFindGuides(nplCandidate.layers, parentPath.concat([nplGuideIndex]), guides);
  }
}
/** The advisory read: a host error becomes an unavailable scan instead of failing the call that only wants to add a note. */
function nplScanSafe(nplDocument) {
  try { return nplScan(nplDocument, false); }
  catch (nplScanError) { return { layers: [], truncated: false, unavailable: true }; }
}
function nplScan(nplDocument, hide) {
  var scan = { layers: [], truncated: false };
  nplWalk(nplDocument.layers, [], hide, scan);
  return scan;
}
`;
