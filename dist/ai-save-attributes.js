import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { parseAiVersionMarks, VERSION_MARK_SCAN_BYTES } from './ai-version-mark.js';
import { PDF_STRUCTURE_LIMITS, PdfStructureError, fileSource, isDict, isRef, nameOf, openPdfDocument } from './pdf-structure.js';
import { noFollowReadFlags } from './platform-primitives.js';
export const MAX_ATTRIBUTE_READ_BYTES = 512 * 1024 * 1024;
const MAX_ICC_PROFILE_BYTES = 16 * 1024 * 1024;
const MAX_PAGES = 1_000;
const MAX_PRIVATE_BLOCKS = 4_096;
const ZSTD_PRIVATE_DATA = '%AI24_ZStandard_Data';
const CURRENT_MARKS = Object.freeze({ creator: '24.0', fileFormat: '14.0' });
const LIMITS = Object.freeze({ ...PDF_STRUCTURE_LIMITS, maxFileBytes: MAX_ATTRIBUTE_READ_BYTES, maxPages: MAX_PAGES });
class Unknown extends Error {
    reason;
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}
const unknown = (reason) => { throw new Unknown(reason); };
const dictOf = (value, reason) => (isDict(value) ? value : unknown(reason));
async function iccProfileId(doc, ref) {
    if (!isRef(ref))
        return unknown('icc_profile_not_a_reference');
    const stream = await doc.stream(ref);
    if (stream === null)
        return unknown('icc_profile_not_a_stream');
    const declared = stream.dict.get('Length');
    if (typeof declared === 'number' && declared > MAX_ICC_PROFILE_BYTES)
        return unknown('icc_profile_too_large');
    const data = stream.decoded();
    if (data.length < 132 || data.length > MAX_ICC_PROFILE_BYTES || data.toString('latin1', 36, 40) !== 'acsp')
        return unknown('icc_profile_not_a_profile');
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
}
async function documentColourSpaceProfiles(doc, value) {
    const space = await doc.resolve(value);
    const name = nameOf(space);
    if (name === 'DeviceCMYK' || name === 'DeviceRGB' || name === 'DeviceGray')
        return [];
    if (Array.isArray(space) && space.length === 2 && nameOf(space[0]) === 'ICCBased')
        return [await iccProfileId(doc, space[1])];
    return unknown('document_colour_space_form_unsupported');
}
async function pagesOf(doc) {
    const pages = [];
    const seen = new Set();
    const walk = async (node, depth) => {
        if (depth > 64)
            return unknown('page_tree_too_deep');
        if (isRef(node)) {
            const key = node.ref.join(' ');
            if (seen.has(key))
                return unknown('page_tree_cycle');
            seen.add(key);
        }
        const dict = dictOf(await doc.resolve(node), 'page_tree_node_not_a_dictionary');
        const type = nameOf(dict.get('Type'));
        if (type === 'Pages') {
            const kids = await doc.resolve(dict.get('Kids'));
            if (!Array.isArray(kids))
                return unknown('page_tree_kids_missing');
            for (const kid of kids)
                await walk(kid, depth + 1);
            return;
        }
        if (type !== 'Page')
            return unknown('page_tree_leaf_not_a_page');
        if (pages.length >= MAX_PAGES)
            return unknown('too_many_pages');
        pages.push(dict);
    };
    await walk(doc.catalog.get('Pages'), 0);
    if (pages.length === 0)
        unknown('no_pages');
    return pages;
}
async function readIccProfiles(doc, pages) {
    const ids = new Set();
    for (const page of pages) {
        const group = await doc.resolve(page.get('Group'));
        if (!isDict(group))
            return unknown('page_group_missing');
        for (const id of await documentColourSpaceProfiles(doc, group.get('CS')))
            ids.add(id);
    }
    const intents = await doc.resolve(doc.catalog.get('OutputIntents'));
    if (intents !== undefined && intents !== null) {
        if (!Array.isArray(intents))
            return unknown('output_intents_unreadable');
        for (const entry of intents) {
            const intent = dictOf(await doc.resolve(entry), 'output_intent_unreadable');
            if (intent.has('DestOutputProfile'))
                ids.add(await iccProfileId(doc, intent.get('DestOutputProfile')));
        }
    }
    return [...ids].sort();
}
async function readOptionalContent(doc) {
    const properties = await doc.resolve(doc.catalog.get('OCProperties'));
    if (properties === undefined || properties === null)
        return false;
    const groups = await doc.resolve(dictOf(properties, 'optional_content_properties_unreadable').get('OCGs'));
    if (!Array.isArray(groups))
        return unknown('optional_content_groups_unreadable');
    return groups.length > 0;
}
async function readCompression(doc, pages) {
    for (const page of pages) {
        const pieceInfo = await doc.resolve(page.get('PieceInfo'));
        if (!isDict(pieceInfo))
            continue;
        const illustrator = await doc.resolve(pieceInfo.get('Illustrator'));
        if (!isDict(illustrator))
            continue;
        const priv = await doc.resolve(illustrator.get('Private'));
        if (!isDict(priv))
            continue;
        const blocks = await doc.resolve(priv.get('NumBlock'));
        if (typeof blocks !== 'number' || !Number.isInteger(blocks) || blocks < 1 || blocks > MAX_PRIVATE_BLOCKS)
            return unknown('private_data_block_count_unreadable');
        for (let index = 1; index <= blocks; index += 1) {
            const reference = priv.get(`AIPrivateData${index}`);
            const stream = isRef(reference) ? await doc.stream(reference) : null;
            if (stream === null)
                return unknown('private_data_block_not_a_stream');
            if (stream.raw.toString('latin1', 0, ZSTD_PRIVATE_DATA.length) === ZSTD_PRIVATE_DATA)
                return true;
        }
        return false;
    }
    return unknown('private_data_not_found');
}
export async function readAiAttributesFromSource(source, head) {
    const marks = parseAiVersionMarks(head);
    const reasons = [];
    const result = { iccProfiles: null, pdfCompatible: null, compressed: null, marks, reasons };
    const attempt = async (fn) => {
        try {
            return await fn();
        }
        catch (error) {
            if (error instanceof Unknown) {
                reasons.push(error.reason);
                return null;
            }
            if (error instanceof PdfStructureError) {
                reasons.push(`pdf_structure:${error.code}`);
                return null;
            }
            throw error;
        }
    };
    const doc = await attempt(() => openPdfDocument(source, LIMITS));
    if (doc === null)
        return result;
    if (doc.encrypted) {
        reasons.push('pdf_encrypted');
        return result;
    }
    result.pdfCompatible = await attempt(() => readOptionalContent(doc));
    const pages = await attempt(() => pagesOf(doc));
    if (pages !== null)
        result.iccProfiles = await attempt(() => readIccProfiles(doc, pages));
    const current = marks.creator === CURRENT_MARKS.creator && marks.fileFormat === CURRENT_MARKS.fileFormat;
    if (!current)
        reasons.push('compression_not_determinable_for_this_file_version');
    else if (pages !== null)
        result.compressed = await attempt(() => readCompression(doc, pages));
    return result;
}
export async function readAiFileAttributesFromBytes(buf) {
    const source = { size: buf.length, read: async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length)) };
    return await readAiAttributesFromSource(source, buf.subarray(0, VERSION_MARK_SCAN_BYTES));
}
export async function readAiFileAttributes(path) {
    let handle;
    try {
        handle = await open(path, noFollowReadFlags());
    }
    catch (error) {
        return { readable: false, reason: `file_unreadable:${error instanceof Error ? error.message : String(error)}`.slice(0, 200) };
    }
    try {
        const info = await handle.stat();
        if (!info.isFile())
            return { readable: false, reason: 'not_a_regular_file' };
        if (info.size > MAX_ATTRIBUTE_READ_BYTES)
            return { readable: false, reason: 'file_too_large_to_read' };
        const headBuffer = Buffer.alloc(Math.min(VERSION_MARK_SCAN_BYTES, info.size));
        const { bytesRead } = await handle.read(headBuffer, 0, headBuffer.length, 0);
        return { readable: true, attributes: await readAiAttributesFromSource(fileSource(handle, info.size), headBuffer.subarray(0, bytesRead)) };
    }
    catch (error) {
        return { readable: false, reason: `file_unreadable:${error instanceof Error ? error.message : String(error)}`.slice(0, 200) };
    }
    finally {
        await handle.close();
    }
}
const statusSchema = z.enum(['preserved', 'changed', 'unknown']);
export const saveAttributesSchema = z.strictObject({
    verified: z.boolean().describe('true only when every attribute below is preserved. Any unknown attribute makes it false; unknown is not "preserved".'),
    icc_profiles: z.strictObject({ status: statusSchema, before: z.number().int().nonnegative().nullable(), after: z.number().int().nonnegative().nullable() })
        .describe('The embedded ICC profiles of the document (the colour space of the transparency group of each page and the output intents; the profile of an image is not counted), compared as a set before and after the save: a lost, added or changed document profile is a change.'),
    pdf_compatible: z.strictObject({ status: statusSchema, before: z.boolean().nullable(), after: z.boolean().nullable() })
        .describe('Whether the file carries PDF-compatible content (optional content groups).'),
    compression: z.strictObject({ status: statusSchema, before: z.boolean().nullable(), after: z.boolean().nullable() })
        .describe('Whether the file is compressed. Readable only in a current-version file; an older-version file is unknown, never "not compressed".'),
    file_version: z.strictObject({ status: statusSchema, before: z.string().nullable(), after: z.string().nullable() })
        .describe('The %%Creator / %AI5_FileFormat version marks of the file.'),
    reasons: z.array(z.string()).describe('Why an attribute is unknown (empty when all were established).'),
});
const markText = (marks) => (marks.creator === null && marks.fileFormat === null ? null : `${marks.creator ?? '?'}/${marks.fileFormat ?? '?'}`);
export function compareSaveAttributes(before, after) {
    const reasons = [];
    if (!before.readable)
        reasons.push(`before:${before.reason}`);
    if (!after.readable)
        reasons.push(`after:${after.reason}`);
    const b = before.readable ? before.attributes : null;
    const a = after.readable ? after.attributes : null;
    if (b !== null)
        reasons.push(...b.reasons.map((reason) => `before:${reason}`));
    if (a !== null)
        reasons.push(...a.reasons.map((reason) => `after:${reason}`));
    const judge = (x, y, equal) => x === null || x === undefined || y === null || y === undefined ? 'unknown' : (equal(x, y) ? 'preserved' : 'changed');
    const sameList = (p, q) => p.length === q.length && p.every((value, index) => value === q[index]);
    const icc = judge(b?.iccProfiles, a?.iccProfiles, sameList);
    const pdf = judge(b?.pdfCompatible, a?.pdfCompatible, (p, q) => p === q);
    const compression = judge(b?.compressed, a?.compressed, (p, q) => p === q);
    const version = judge(b === null ? null : markText(b.marks), a === null ? null : markText(a.marks), (p, q) => p === q);
    const changed = [];
    if (icc === 'changed')
        changed.push('icc_profiles');
    if (pdf === 'changed')
        changed.push('pdf_compatible');
    if (compression === 'changed')
        changed.push('compression');
    if (version === 'changed')
        changed.push('file_version');
    const statuses = [icc, pdf, compression, version];
    return {
        changed,
        attributes: {
            verified: statuses.every((status) => status === 'preserved'),
            icc_profiles: { status: icc, before: b?.iccProfiles?.length ?? null, after: a?.iccProfiles?.length ?? null },
            pdf_compatible: { status: pdf, before: b?.pdfCompatible ?? null, after: a?.pdfCompatible ?? null },
            compression: { status: compression, before: b?.compressed ?? null, after: a?.compressed ?? null },
            file_version: { status: version, before: b === null ? null : markText(b.marks), after: a === null ? null : markText(a.marks) },
            reasons: [...new Set(reasons)],
        },
    };
}
