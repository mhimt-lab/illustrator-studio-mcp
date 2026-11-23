import { execFile } from 'node:child_process';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { win32 as path } from 'node:path';
import { parseAdobeFontList } from '../font-verification.js';
import { measureWindowsDuration } from './perf-probe.js';
export const WINDOWS_FONT_CACHE_TTL_MS = 30_000;
export const WINDOWS_FONT_REGISTRY_KEYS = Object.freeze([
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
]);
const MAX_TABLE_BYTES = 2 * 1024 * 1024;
const MAX_READ_BYTES = 128 * 1024 * 1024;
const MAX_FILES = 16_384;
const INTERNAL_FONTS = new Set(['AdobeInvisible2-Regular', 'AdobeSansMM']);
const readers = {
    registry: (file, args) => new Promise((resolve, reject) => {
        execFile(file, [...args], { encoding: 'buffer', timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
    }),
    stat: async (file) => { const value = await stat(file); if (!value.isFile())
        throw new Error('FONT_NOT_FILE'); return value; },
    realpath,
    read: async (file, offset, length) => {
        const handle = await open(file, 'r');
        try {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            if (bytesRead !== length)
                throw new Error('FONT_SHORT_READ');
            return buffer;
        }
        finally {
            await handle.close();
        }
    },
    directories: async (root) => (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name),
};
export function windowsFontPath(value, relativeRoot) {
    if (!value || /[\x00-\x1f<>"|?*]/u.test(value))
        return null;
    const normalized = value.replaceAll('/', '\\');
    if (normalized.startsWith('\\') || normalized.split('\\').some(part => part === '..' || part === '.' || /[ .]$/u.test(part)))
        return null;
    const absolute = /^[a-z]:\\/iu.test(normalized);
    if (normalized.slice(absolute ? 2 : 0).includes(':'))
        return null;
    if (!absolute && relativeRoot === undefined)
        return null;
    const resolved = absolute ? path.normalize(normalized) : path.join(relativeRoot, normalized);
    return /^[a-z]:\\/iu.test(resolved) ? resolved : null;
}
const identity = (file) => path.normalize(file).toLowerCase();
const sameStamp = (a, b) => a.size === b.size && a.mtimeMs === b.mtimeMs;
const inside = (file, root) => identity(file).startsWith(`${identity(root).replace(/\\$/u, '')}\\`);
export function decodeWindowsFontRegistry(bytes) {
    for (const encoding of ['utf-8', 'shift_jis']) {
        try {
            return new TextDecoder(encoding, { fatal: true }).decode(bytes);
        }
        catch { }
    }
    return null;
}
export function registeredFontPaths(text, systemRoot) {
    const files = new Set();
    for (const line of text.split(/\r?\n/u)) {
        const match = /^\s+.+?\s+REG_SZ\s+(.+)$/u.exec(line);
        const file = match ? windowsFontPath(match[1], path.join(systemRoot, 'Fonts')) : null;
        if (file)
            files.add(file);
        if (files.size > MAX_FILES)
            throw new Error('FONT_FILE_LIMIT');
    }
    return [...files];
}
export function sfntPostScriptName(bytes) {
    try {
        const data = Buffer.from(bytes);
        if (data.length < 6 || data.readUInt16BE(0) > 1)
            return null;
        const count = data.readUInt16BE(2), strings = data.readUInt16BE(4);
        if (count > 4096 || 6 + count * 12 > data.length || strings < 6 + count * 12 || strings > data.length)
            return null;
        for (let index = 0; index < count; index++) {
            const at = 6 + index * 12;
            if (data.readUInt16BE(at) !== 3 || data.readUInt16BE(at + 6) !== 6)
                continue;
            const encoding = data.readUInt16BE(at + 2), length = data.readUInt16BE(at + 8), offset = strings + data.readUInt16BE(at + 10);
            if (![0, 1, 10].includes(encoding) || length === 0 || length % 2 || offset + length > data.length)
                return null;
            const name = new TextDecoder('utf-16be', { fatal: true, ignoreBOM: true }).decode(data.subarray(offset, offset + length));
            if (name.trim() !== name)
                return null;
            const normalized = name.replaceAll(' ', '-');
            return /^[\x21-\x7e]{1,63}$/u.test(normalized) ? normalized : null;
        }
    }
    catch { }
    return null;
}
export async function readSfntNames(size, read) {
    const range = async (offset, length) => {
        if (!Number.isSafeInteger(size) || offset < 0 || length < 0 || offset + length > size || length > MAX_TABLE_BYTES)
            throw new Error('FONT_RANGE');
        const data = Buffer.from(await read(offset, length));
        if (data.length !== length)
            throw new Error('FONT_SHORT_READ');
        return data;
    };
    const header = await range(0, 12);
    let offsets = [0];
    if (header.toString('ascii', 0, 4) === 'ttcf') {
        const version = header.readUInt32BE(4), count = header.readUInt32BE(8);
        if (![0x00010000, 0x00020000].includes(version) || count === 0 || count > 256)
            throw new Error('FONT_COLLECTION');
        const directory = await range(12, count * 4);
        offsets = Array.from({ length: count }, (_, index) => directory.readUInt32BE(index * 4));
    }
    const names = [];
    for (const offset of offsets) {
        const face = offset === 0 ? header : await range(offset, 12);
        if (![0x00010000, 0x4f54544f, 0x74727565].includes(face.readUInt32BE(0)))
            throw new Error('FONT_NOT_SFNT');
        const count = face.readUInt16BE(4);
        if (count === 0 || count > 256)
            throw new Error('FONT_TABLE_COUNT');
        const directory = await range(offset + 12, count * 16);
        let nameTable = null;
        for (let index = 0; index < count; index++) {
            const at = index * 16, tableOffset = directory.readUInt32BE(at + 8), length = directory.readUInt32BE(at + 12);
            if (tableOffset + length > size)
                throw new Error('FONT_TABLE_RANGE');
            if (directory.toString('ascii', at, at + 4) !== 'name')
                continue;
            if (nameTable !== null)
                throw new Error('FONT_DUPLICATE_TABLE');
            nameTable = { offset: tableOffset, length };
        }
        if (nameTable) {
            const name = sfntPostScriptName(await range(nameTable.offset, nameTable.length));
            if (name)
                names.push(name);
        }
    }
    return names;
}
export class WindowsFontVerifier {
    options;
    cache = null;
    loading = null;
    io;
    now;
    constructor(options = {}) {
        this.options = options;
        this.io = options.readers ?? readers;
        this.now = options.now ?? Date.now;
    }
    warmUp() { return this.refresh().then(() => undefined, () => undefined); }
    verify(names, _applicationBundleId = null) {
        return measureWindowsDuration('win.font.verify', () => this.verifyNames(names), this.options.durationObserver);
    }
    async verifyNames(names) {
        const unique = [...new Set(names)];
        const result = Object.fromEntries(unique.map(name => [name, null]));
        if (!unique.length)
            return result;
        try {
            const applicationKey = JSON.stringify(this.options.application?.() ?? null);
            const needsLoad = !this.cache || this.cache.applicationKey !== applicationKey || this.now() < this.cache.at
                || this.now() - this.cache.at >= WINDOWS_FONT_CACHE_TTL_MS;
            if (needsLoad)
                await this.warmUp();
            let snapshot = this.cache;
            if (!needsLoad && unique.some(name => !snapshot?.names.has(name)))
                snapshot = await this.refresh();
            if (!snapshot || snapshot.applicationKey !== JSON.stringify(this.options.application?.() ?? null))
                return result;
            for (const name of unique) {
                const candidate = snapshot.names.get(name);
                if (!candidate)
                    continue;
                try {
                    for (const file of candidate.files) {
                        if (identity(await this.io.realpath(file.path)) !== file.canonical || !sameStamp(await this.io.stat(file.path), file))
                            throw new Error('FONT_CHANGED');
                    }
                    result[name] = candidate.source;
                }
                catch { }
            }
            if (snapshot.applicationKey !== JSON.stringify(this.options.application?.() ?? null))
                return Object.fromEntries(unique.map(name => [name, null]));
        }
        catch {
            for (const name of unique)
                result[name] = null;
        }
        return result;
    }
    refresh() {
        if (this.loading)
            return this.loading;
        this.loading = measureWindowsDuration('win.font.load', () => this.load(), this.options.durationObserver)
            .then(snapshot => { this.cache = snapshot; return snapshot; }, error => { this.cache = null; throw error; })
            .finally(() => { this.loading = null; });
        return this.loading;
    }
    async stamp(file) {
        const canonical = windowsFontPath(await this.io.realpath(file));
        if (!canonical)
            throw new Error('FONT_PATH');
        const value = await this.io.stat(file);
        if (!Number.isSafeInteger(value.size) || value.size < 0 || !Number.isFinite(value.mtimeMs))
            throw new Error('FONT_STAT');
        return { path: file, canonical: identity(canonical), size: value.size, mtimeMs: value.mtimeMs };
    }
    async load() {
        const at = this.now();
        const application = this.options.application?.() ?? null;
        const names = new Map(), ambiguous = new Set();
        let bytes = 0;
        const read = async (file, offset, length) => {
            bytes += length;
            if (length > MAX_TABLE_BYTES || bytes > MAX_READ_BYTES)
                throw new Error('FONT_READ_LIMIT');
            return this.io.read(file, offset, length);
        };
        const add = (name, candidate) => {
            const existing = names.get(name);
            if (existing && existing.files[0].canonical !== candidate.files[0].canonical)
                ambiguous.add(name);
            else
                names.set(name, candidate);
        };
        const root = windowsFontPath(this.options.systemRoot ?? process.env.SystemRoot ?? '');
        if (root) {
            try {
                const output = await Promise.all(WINDOWS_FONT_REGISTRY_KEYS.map(async (key) => {
                    try {
                        const raw = await this.io.registry(path.join(root, 'System32', 'reg.exe'), ['query', key]);
                        const text = decodeWindowsFontRegistry(raw);
                        if (text === null || !/^\s*HKEY_(LOCAL_MACHINE|CURRENT_USER)\\/mu.test(text))
                            throw new Error('FONT_REGISTRY_FORMAT');
                        return registeredFontPaths(text, root);
                    }
                    catch {
                        return [];
                    }
                }));
                const files = new Map();
                for (const keyFiles of output)
                    for (const file of keyFiles)
                        files.set(identity(file), file);
                if (files.size > MAX_FILES)
                    throw new Error('FONT_FILE_LIMIT');
                for (const file of files.values()) {
                    try {
                        const before = await this.stamp(file);
                        const found = await readSfntNames(before.size, (offset, length) => read(file, offset, length));
                        const after = await this.stamp(file);
                        if (before.canonical !== after.canonical || !sameStamp(before, after))
                            continue;
                        for (const name of found)
                            add(name, { source: 'windows_registered_font', files: [before] });
                    }
                    catch { }
                }
            }
            catch { }
        }
        const appData = windowsFontPath(this.options.appData ?? process.env.APPDATA ?? '');
        const exe = application && windowsFontPath(application.executablePath);
        const major = application && /^(\d+)\./u.exec(application.fileVersion)?.[1];
        if (exe && major && appData && /\\Support Files\\Contents\\Windows\\Illustrator\.exe$/iu.test(exe)) {
            try {
                const required = await this.io.realpath(path.resolve(path.dirname(exe), '..', '..', 'Required'));
                const root = path.join(appData, 'Adobe', `Adobe Illustrator ${major} Settings`);
                const locales = await this.io.directories(root);
                if (locales.length > 256)
                    throw new Error('FONT_LOCALE_LIMIT');
                for (const locale of locales) {
                    if (!/^[\w-]+$/u.test(locale))
                        continue;
                    const file = path.join(root, locale, 'x64', 'IllustratorFnt.lst');
                    try {
                        const list = await this.stamp(file);
                        const blocks = parseAdobeFontList(new TextDecoder('utf-8', { fatal: true }).decode(await read(file, 0, list.size)));
                        if (!blocks || blocks.length > MAX_FILES)
                            continue;
                        const pending = [];
                        for (const block of blocks) {
                            const name = block.FontName;
                            if (!name || !/^[\x21-\x7e]{1,63}$/u.test(name) || INTERNAL_FONTS.has(name))
                                continue;
                            const outline = windowsFontPath((block.OutlineFileName ?? '').replaceAll('\\\\', '\\'));
                            if (!outline)
                                continue;
                            try {
                                const font = await this.stamp(outline);
                                if (!inside(font.canonical, required) || String(font.size) !== block.FileLength)
                                    continue;
                                pending.push([name, { source: 'illustrator_bundled_font_list', files: [font, list] }]);
                            }
                            catch { }
                        }
                        const after = await this.stamp(file);
                        if (list.canonical === after.canonical && sameStamp(list, after))
                            for (const [name, candidate] of pending)
                                add(name, candidate);
                    }
                    catch { }
                }
            }
            catch { }
        }
        for (const name of ambiguous)
            names.delete(name);
        if (bytes > MAX_READ_BYTES)
            names.clear();
        return { names, at, applicationKey: JSON.stringify(application) };
    }
}
