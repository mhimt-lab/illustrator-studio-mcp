import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
const exec = promisify(execFile);
const bindingEqual = (left, right) => left !== null && right !== null && left.pid === right.pid && left.processStart === right.processStart &&
    left.version === right.version && left.bundlePath === right.bundlePath;
export const observeFontInventoryIdentity = async (target) => {
    if (process.platform !== 'darwin' || target.bundleId !== 'com.adobe.illustrator' || target.channel !== 'stable')
        return null;
    const run = async (file, args) => (await exec(file, args, { timeout: 5_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })).stdout.trim();
    try {
        const pidText = await run('lsappinfo', ['info', '-only', 'pid', '-app', target.bundleId]);
        const pid = Number(/pid = (\d+)/u.exec(pidText)?.[1]);
        const bundlePath = /bundle path="([^"]+)"/u.exec(await run('lsappinfo', ['info', '-only', 'bundlepath', '-app', target.bundleId]))?.[1];
        if (!Number.isSafeInteger(pid) || pid <= 0 || bundlePath === undefined)
            return null;
        const processStart = await run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)]);
        const version = await run('/usr/bin/defaults', ['read', bundlePath + '/Contents/Info', 'CFBundleShortVersionString']);
        if (!Number.isFinite(Date.parse(processStart)) || version !== '30.8.2')
            return null;
        if (Number(/pid = (\d+)/u.exec(await run('lsappinfo', ['info', '-only', 'pid', '-app', target.bundleId]))?.[1]) !== pid)
            return null;
        return { pid, processStart, version, bundlePath };
    }
    catch {
        return null;
    }
};
const captureSchema = z.strictObject({
    documents: z.literal(0), version: z.literal('30.8.2'),
    count: z.number().int().nonnegative(), names: z.array(z.string().min(1).max(255)),
}).superRefine((value, context) => {
    if (value.count !== value.names.length)
        context.addIssue({ code: 'custom', message: 'Incomplete Illustrator font inventory.' });
});
export const CAPTURE_CLEAN_FONT_INVENTORY_SCRIPT = `
var mcpCleanFontInventory = null;
if (app.documents.length === 0 && String(app.version) === "30.8.2") {
  var mcpFontCount = app.textFonts.length;
  var mcpFontNames = [];
  for (var mcpFontIndex = 0; mcpFontIndex < mcpFontCount; mcpFontIndex++) {
    var mcpFontName = app.textFonts[mcpFontIndex].name;
    if (typeof mcpFontName !== "string" || mcpFontName.length === 0 || mcpFontName.length > 255) throw new Error("FONT_INVENTORY_UNREADABLE");
    mcpFontNames.push(mcpFontName);
  }
  if (app.documents.length !== 0 || app.textFonts.length !== mcpFontCount) throw new Error("FONT_INVENTORY_CHANGED_DURING_SCAN");
  mcpCleanFontInventory = { documents: 0, version: String(app.version), count: mcpFontCount, names: mcpFontNames };
}
`;
export class IllustratorFontInventory {
    observe;
    #snapshot = null;
    constructor(observe = observeFontInventoryIdentity) {
        this.observe = observe;
    }
    clear() { this.#snapshot = null; }
    async current(target) {
        const current = target === null ? null : await this.observe(target);
        if (!bindingEqual(current, this.#snapshot?.binding ?? null))
            this.clear();
        return current;
    }
    async captureBinding(target) {
        const current = await this.current(target);
        return this.#snapshot === null ? current : null;
    }
    async assertBinding(binding, target) {
        if (!bindingEqual(binding, await this.current(target)))
            throw new Error('FONT_INVENTORY_PROCESS_CHANGED: Obtain a fresh documents=0 snapshot.');
    }
    accept(binding, data) {
        if (data === null)
            return;
        this.clear();
        const capture = captureSchema.parse(data);
        if (capture.version !== binding.version)
            throw new Error('FONT_INVENTORY_VERSION_MISMATCH');
        this.#snapshot = { binding: { ...binding }, names: new Set(capture.names) };
    }
    async verify(external, target) {
        await this.current(target);
        return Object.fromEntries(Object.entries(external).map(([name, source]) => [name, source ?? (this.#snapshot?.names.has(name) === true ? 'illustrator_inventory' : null)]));
    }
    guard(verification, target) {
        const names = Object.entries(verification).filter(([, source]) => source === 'illustrator_inventory').map(([name]) => name);
        if (names.length === 0)
            return null;
        const snapshot = this.#snapshot;
        return async () => {
            if (snapshot === null)
                throw new Error('FONT_INVENTORY_NOT_CAPTURED');
            await this.assertBinding(snapshot.binding, target);
            if (this.#snapshot !== snapshot || names.some((name) => !snapshot.names.has(name)))
                throw new Error('FONT_INVENTORY_STALE');
        };
    }
}
