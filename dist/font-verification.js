import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_BUNDLE_ID = 'com.adobe.illustrator';
export const CORETEXT_VERIFY_JXA = `ObjC.import('CoreText');
ObjC.import('Foundation');
function run(argv) {
  var wanted = JSON.parse(argv[0]);
  var names = ObjC.deepUnwrap(ObjC.castRefToObject($.CTFontManagerCopyAvailablePostScriptNames()));
  var listed = {};
  for (var i = 0; i < names.length; i++) listed[names[i]] = true;
  var out = {};
  for (var w = 0; w < wanted.length; w++) {
    var ok = listed[wanted[w]] === true;
    if (!ok) {
      var font = $.CTFontCreateWithName($(wanted[w]), 12, null);
      ok = ObjC.unwrap(ObjC.castRefToObject($.CTFontCopyPostScriptName(font))) === wanted[w];
    }
    out[wanted[w]] = ok;
  }
  return JSON.stringify(out);
}`;
const CMAP_SUFFIX = /-(?:83pv-|90pv-|90ms-)?RKSJ-H$/u;
export function osFontListNames(fontName) {
    const base = fontName.replace(CMAP_SUFFIX, '');
    const names = [fontName];
    if (base !== fontName) {
        names.push(base);
        if (base.endsWith('-WIN'))
            names.push(base.slice(0, -'-WIN'.length));
    }
    return names;
}
export function parseAdobeFontList(text) {
    if (!text.startsWith('%!Adobe-FontList'))
        return null;
    const blocks = [];
    for (const match of text.matchAll(/%BeginFont\r?\n([\s\S]*?)%EndFont/gu)) {
        const block = {};
        for (const line of match[1].split(/\r?\n/u)) {
            const colon = line.indexOf(':');
            if (colon > 0 && !(line.slice(0, colon) in block))
                block[line.slice(0, colon)] = line.slice(colon + 1);
        }
        blocks.push(block);
    }
    return blocks;
}
export class SystemFontVerifier {
    options;
    #osList = null;
    #bundledList = null;
    constructor(options = {}) {
        this.options = options;
    }
    async verify(names, applicationBundleId) {
        const unique = [...new Set(names)];
        const result = Object.fromEntries(unique.map((name) => [name, null]));
        const coreText = await this.#coreText(unique);
        for (const name of unique)
            if (coreText[name] === true)
                result[name] = 'coretext';
        const pending = unique.filter((name) => result[name] === null);
        if (pending.length === 0)
            return result;
        const application = await this.#runningApplication(applicationBundleId ?? DEFAULT_BUNDLE_ID);
        if (application === null)
            return result;
        const osNames = await this.#osFontNames(application);
        const bundledNames = await this.#bundledFontNames(application);
        for (const name of pending) {
            if (osNames.has(name))
                result[name] = 'illustrator_os_font_list';
            else if (bundledNames.has(name))
                result[name] = 'illustrator_bundled_font_list';
        }
        return result;
    }
    get #run() { return this.options.runCommand ?? execFileAsync; }
    get #home() { return this.options.home ?? homedir(); }
    async #coreText(names) {
        try {
            const { stdout } = await this.#run('osascript', ['-l', 'JavaScript', '-e', CORETEXT_VERIFY_JXA, JSON.stringify(names)], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
            const parsed = JSON.parse(stdout.trim());
            if (parsed === null || typeof parsed !== 'object')
                return {};
            return Object.fromEntries(names.map((name) => [name, parsed[name] === true]));
        }
        catch {
            return {};
        }
    }
    async #runningApplication(bundleId) {
        try {
            const lookup = async (field) => (await this.#run('lsappinfo', ['info', '-only', field, '-app', bundleId], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 })).stdout;
            const pid = /pid = (\d+)/u.exec(await lookup('pid'))?.[1];
            const bundlePath = /bundle path="([^"]+)"/u.exec(await lookup('bundlepath'))?.[1];
            if (pid === undefined || bundlePath === undefined)
                return null;
            const started = (await this.#run('/bin/ps', ['-o', 'lstart=', '-p', pid], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })).stdout.trim();
            const startedAtMs = Date.parse(started);
            const version = (await this.#run('/usr/bin/defaults', ['read', join(bundlePath, 'Contents', 'Info'), 'CFBundleShortVersionString'], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 })).stdout.trim();
            const major = /^(\d+)\./u.exec(version)?.[1];
            if (!Number.isFinite(startedAtMs) || major === undefined)
                return null;
            return { bundlePath, major, startedAtMs };
        }
        catch {
            return null;
        }
    }
    async #osFontNames(application) {
        const root = join(this.#home, 'Library', 'Preferences', `Adobe Illustrator ${application.major} Settings`);
        const files = await freshFiles(root, 'AdobeFnt_OSFonts.lst', application.startedAtMs);
        const key = JSON.stringify(files);
        if (this.#osList?.key === key)
            return this.#osList.names;
        const names = new Set();
        for (const file of files) {
            const blocks = parseAdobeFontList(await readFile(file.path, 'utf8').catch(() => ''));
            if (blocks === null)
                continue;
            for (const block of blocks)
                if (block.FontName)
                    for (const name of osFontListNames(block.FontName))
                        names.add(name);
        }
        this.#osList = { key, names };
        return names;
    }
    async #bundledFontNames(application) {
        const root = join(this.#home, 'Library', 'Application Support', 'Adobe', `Adobe Illustrator ${application.major}`);
        const files = await freshFiles(root, 'IllustratorFnt.lst', 0);
        const required = `${join(application.bundlePath, 'Contents', 'Required')}/`;
        const key = JSON.stringify({ files, required });
        if (this.#bundledList?.key === key)
            return this.#bundledList.names;
        const names = new Set();
        for (const file of files) {
            const blocks = parseAdobeFontList(await readFile(file.path, 'utf8').catch(() => ''));
            if (blocks === null)
                continue;
            for (const block of blocks) {
                const outline = block.OutlineFileName ?? '';
                if (!block.FontName || !outline.startsWith(required))
                    continue;
                const size = await stat(outline).then((entry) => entry.size, () => -1);
                if (size >= 0 && String(size) === block.FileLength)
                    names.add(block.FontName);
            }
        }
        this.#bundledList = { key, names };
        return names;
    }
}
async function freshFiles(root, fileName, sinceMs) {
    const locales = await readdir(root).catch(() => []);
    const files = [];
    for (const locale of locales.sort()) {
        const path = join(root, locale, fileName);
        const entry = await stat(path).catch(() => null);
        if (entry !== null && entry.isFile() && entry.mtimeMs >= sinceMs)
            files.push({ path, mtimeMs: entry.mtimeMs, size: entry.size });
    }
    return files;
}
export class StaticFontVerifier {
    names;
    constructor(names) {
        this.names = names;
    }
    async verify(names) {
        return Object.fromEntries(names.map((name) => [name, this.names === 'all' || this.names.has(name) ? 'coretext' : null]));
    }
}
