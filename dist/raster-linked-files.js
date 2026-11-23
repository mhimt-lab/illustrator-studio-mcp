import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { EXPORT_HELPERS } from './document-export.js';
import { documentKeyMatches } from './document-key.js';
export const RASTER_LINK_LIMIT = 100;
export const RASTER_READ_LINKS_SCRIPT = `${EXPORT_HELPERS}
var rasterLinkContext = requireDocumentForRead(params.expectedDocumentKey);
var rasterLinkDocument = app.activeDocument;
var rasterLinkRows = [];
for (var rasterLinkCursor = 0; rasterLinkCursor < rasterLinkDocument.placedItems.length; rasterLinkCursor++) {
  var rasterLinkItem = rasterLinkDocument.placedItems[rasterLinkCursor];
  var rasterLinkRow = { index: rasterLinkCursor, path: null, error: null, itemName: "", bounds: null, inGroup: false, clipped: false };
  try { rasterLinkRow.path = String(rasterLinkItem.file.fsName); }
  catch (rasterLinkFileError) { rasterLinkRow.error = { code: (typeof rasterLinkFileError.number === "number") ? rasterLinkFileError.number : -1, message: String(rasterLinkFileError.message || rasterLinkFileError).substring(0, 160) }; }
  try { rasterLinkRow.itemName = String(rasterLinkItem.name); } catch (rasterLinkNameError) {}
  try {
    var rasterLinkBounds = rasterLinkItem.geometricBounds;
    rasterLinkRow.bounds = [Number(rasterLinkBounds[0]), Number(rasterLinkBounds[1]), Number(rasterLinkBounds[2]), Number(rasterLinkBounds[3])];
  } catch (rasterLinkBoundsError) {}
  try {
    var rasterLinkParent = rasterLinkItem.parent;
    for (var rasterLinkGuard = 0; rasterLinkParent && rasterLinkGuard < 50 && String(rasterLinkParent.typename) === "GroupItem"; rasterLinkGuard++) {
      rasterLinkRow.inGroup = true;
      if (rasterLinkParent.clipped === true) rasterLinkRow.clipped = true;
      rasterLinkParent = rasterLinkParent.parent;
    }
  } catch (rasterLinkParentError) {}
  rasterLinkRows.push(rasterLinkRow);
}
var result = { document: rasterLinkContext, links: rasterLinkRows };
`;
const linkRowSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    path: z.string().nullable(),
    error: z.strictObject({ code: z.number().int(), message: z.string() }).nullable(),
    itemName: z.string(),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    inGroup: z.boolean(),
    clipped: z.boolean(),
});
const linkReadSchema = z.object({ document: z.object({ key: z.string() }).passthrough(), links: z.array(linkRowSchema) });
export const rasterLinkFactSchema = z.strictObject({
    index: z.number().int().nonnegative(),
    name: z.string().min(1),
    path: z.string().min(1),
    inGroup: z.boolean(),
    clipped: z.boolean(),
});
const ALTERNATIVES_EN = 'Put the files back where the document links to them and try again. If they cannot be put back, embed the images first, or export with your own script outside this server (that leaves the document unsaved, so create a backup with illustrator_create_backup first and save again afterwards).';
const ALTERNATIVES_JA = '素材を元の場所へ戻してから、もう一度お試しください。戻せない場合は、素材を埋め込んでから書き出すか、クライアント側のスクリプトで書き出してください（スクリプトでの書き出しは書類を未保存状態にするため、先に illustrator_create_backup を取り、書き出し後に保存し直します）。';
const place = (row) => ({
    en: row.inGroup ? (row.clipped ? 'in a clipping group' : 'in a group') : 'directly in a layer',
    ja: row.inGroup ? (row.clipped ? 'クリップグループ内' : 'グループ内') : 'レイヤー直下',
});
const placement = (row) => {
    const where = place(row);
    const spot = row.bounds === null ? null : `(${Math.round(row.bounds[0])}, ${Math.round(row.bounds[1])})`;
    const name = row.itemName.normalize('NFC');
    return {
        en: `link #${row.index}${name.length > 0 ? ` "${name}"` : ''} (${where.en}${spot === null ? '' : `, top-left ${spot}`})`,
        ja: `リンク #${row.index}${name.length > 0 ? `「${name}」` : ''}（${where.ja}${spot === null ? '' : `、左上 ${spot}`}）`,
    };
};
const describeProblem = (row, why) => {
    const where = placement(row);
    return { index: row.index, description: `${where.en}: ${why.en} / ${where.ja}: ${why.ja}` };
};
function rejectionMessage(problems) {
    const shown = problems.slice(0, 10).map((problem) => `- ${problem.description}`).join('\n');
    const more = problems.length > 10 ? `\n- ${problems.length - 10} more / ほか ${problems.length - 10} 件` : '';
    return `${problems.length} linked image(s) cannot be read, so the export is refused. ${ALTERNATIVES_EN}\n`
        + `リンク配置された画像のうち ${problems.length} 件を読めないため、書き出せません。${ALTERNATIVES_JA}\n${shown}${more}`;
}
export async function admitLinkedFiles(args) {
    if (args.placedItems === 0)
        return { kind: 'admitted', links: [], binding: [] };
    if (args.placedItems > RASTER_LINK_LIMIT) {
        return { kind: 'rejected', reason: 'artwork_not_admitted', message: `The document has ${args.placedItems} linked images; this export admits at most ${RASTER_LINK_LIMIT}. リンク配置された画像が ${args.placedItems} 件あります。この書き出しは ${RASTER_LINK_LIMIT} 件までです。` };
    }
    const data = linkReadSchema.parse(await args.readLinks());
    if (!documentKeyMatches(args.documentKey, data.document.key)) {
        return { kind: 'rejected', reason: 'document_key_mismatch', message: 'Illustrator reported a different document key while the linked images were read.' };
    }
    if (data.links.length !== args.placedItems) {
        return { kind: 'rejected', reason: 'document_key_mismatch', message: `The document changed while its linked images were read (${args.placedItems} then ${data.links.length}); plan again.` };
    }
    const problems = [];
    const links = [];
    const binding = [];
    for (const row of data.links) {
        if (row.path === null) {
            const detail = `${row.error?.code ?? 'unknown'} ${row.error?.message ?? ''}`.trim();
            problems.push(describeProblem(row, { en: `the file it links to is missing (Illustrator: ${detail})`, ja: `参照先のファイルがありません（Illustrator: ${detail}）` }));
            continue;
        }
        let metadata;
        try {
            metadata = await stat(row.path, { bigint: true });
        }
        catch (error) {
            const code = error.code;
            const missing = code === 'ENOENT' || code === 'ENOTDIR';
            problems.push(describeProblem(row, missing ? { en: `not found: ${row.path}`, ja: `見つかりません: ${row.path}` } : { en: `cannot be read (${code ?? 'unknown'}): ${row.path}`, ja: `読めません (${code ?? 'unknown'}): ${row.path}` }));
            continue;
        }
        if (!metadata.isFile()) {
            problems.push(describeProblem(row, { en: `not a regular file: ${row.path}`, ja: `ファイルではありません: ${row.path}` }));
            continue;
        }
        links.push({ index: row.index, name: basename(row.path).normalize('NFC'), path: row.path, inGroup: row.inGroup, clipped: row.clipped });
        binding.push({ index: row.index, path: row.path, size: metadata.size.toString(), mtimeNs: metadata.mtimeNs.toString() });
    }
    if (problems.length > 0)
        return { kind: 'rejected', reason: 'linked_file_unavailable', message: rejectionMessage(problems) };
    return { kind: 'admitted', links, binding };
}
