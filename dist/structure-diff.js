import { randomBytes } from 'node:crypto';
import { ObjectNotFoundError, } from './domain.js';
export const STRUCTURE_SNAPSHOT_LIMITS = {
    pageItems: 5_000,
    artboards: 1_000,
    textCharacters: 10_000,
    storedSnapshots: 16,
    storedDiffs: 16,
    pageLimit: 200,
    scopeUuids: 200,
};
export const STRUCTURE_PAGE_LIMITS = {
    budgetBytes: 196_608,
    maxPages: 64,
};
export const STRUCTURE_DIFF_DEFAULT_TOLERANCE_PT = 0.01;
export const STRUCTURE_DIFF_MAX_TOLERANCE_PT = 10;
const TOLERANCE_NORMALIZATION_DIGITS = 12;
export const STRUCTURE_RETENTION = {
    scope: 'process_memory',
    maxSnapshots: STRUCTURE_SNAPSHOT_LIMITS.storedSnapshots,
    maxDiffs: STRUCTURE_SNAPSHOT_LIMITS.storedDiffs,
};
export class StructureSnapshotNotFoundError extends Error {
    constructor(snapshotId) {
        super(`Structure snapshot ${JSON.stringify(snapshotId)} is not held in this MCP process. Snapshots are process-local and are evicted after ${STRUCTURE_SNAPSHOT_LIMITS.storedSnapshots} newer captures; capture a new snapshot.`);
        this.name = 'StructureSnapshotNotFoundError';
    }
}
export class StructureDiffNotFoundError extends Error {
    constructor(diffId) {
        super(`Structure diff ${JSON.stringify(diffId)} is not held in this MCP process. Diffs are process-local and are evicted after ${STRUCTURE_SNAPSHOT_LIMITS.storedDiffs} newer diffs; compute the diff again.`);
        this.name = 'StructureDiffNotFoundError';
    }
}
export function assertStructurePagePlan(data) {
    const expected = [
        ['artboards', data.scan.artboardCount],
        ['pageItems', data.scan.totalPageItems],
    ];
    let cursor = 0;
    for (const [collection, total] of expected) {
        let offset = 0;
        while (offset < total) {
            const page = data.pages[cursor];
            if (page === undefined || page.index !== cursor || page.collection !== collection ||
                page.offset !== offset || !Number.isInteger(page.count) || page.count < 1 ||
                offset + page.count > total || !/^[0-9a-f]{64}$/.test(page.digest)) {
                throw new Error('Illustrator returned an inconsistent structure page plan.');
            }
            offset += page.count;
            cursor++;
        }
    }
    if (cursor !== data.pages.length)
        throw new Error('Illustrator returned an inconsistent structure page plan.');
}
export class StructureSnapshotDocumentMismatchError extends Error {
    constructor(baseKey, targetKey) {
        super(`The base and target structure snapshots belong to different documents. Base ${JSON.stringify(baseKey)}, target ${JSON.stringify(targetKey)}.`);
        this.name = 'StructureSnapshotDocumentMismatchError';
    }
}
export class StructureSnapshotTooLargeError extends Error {
    constructor(collection, total, limit) {
        super(`The document has ${total} ${collection}; structure snapshots support at most ${limit}. Larger documents are unsupported for structural diff.`);
        this.name = 'StructureSnapshotTooLargeError';
    }
}
export class StructureSnapshotChangedError extends Error {
    constructor() {
        super('The Illustrator document changed while the structure snapshot was being read. Capture again.');
        this.name = 'StructureSnapshotChangedError';
    }
}
export class StructureSnapshotPagePlanError extends Error {
    reason;
    constructor(reason, detail) {
        super(`The document cannot be read as a bound structure snapshot (${reason}): ${detail}`);
        this.reason = reason;
        this.name = 'StructureSnapshotPagePlanError';
    }
}
const SNAPSHOT_ID_PATTERN = /^ss_[0-9a-f]{32}$/;
const DIFF_ID_PATTERN = /^sd_[0-9a-f]{32}$/;
export function isStructureSnapshotId(value) {
    return SNAPSHOT_ID_PATTERN.test(value);
}
export function isStructureDiffId(value) {
    return DIFF_ID_PATTERN.test(value);
}
function newId(prefix) {
    return `${prefix}_${randomBytes(16).toString('hex')}`;
}
class BoundedStore {
    maxEntries;
    #entries = new Map();
    constructor(maxEntries) {
        this.maxEntries = maxEntries;
    }
    put(id, value) {
        this.#entries.delete(id);
        this.#entries.set(id, value);
        while (this.#entries.size > this.maxEntries) {
            const oldest = this.#entries.keys().next().value;
            if (oldest === undefined)
                break;
            this.#entries.delete(oldest);
        }
    }
    get(id) {
        const value = this.#entries.get(id);
        if (value === undefined)
            return undefined;
        this.#entries.delete(id);
        this.#entries.set(id, value);
        return value;
    }
    get size() {
        return this.#entries.size;
    }
}
export class StructureSnapshotStore {
    #store = new BoundedStore(STRUCTURE_SNAPSHOT_LIMITS.storedSnapshots);
    add(data, capturedAt) {
        const snapshot = { ...data, snapshotId: newId('ss'), capturedAt };
        this.#store.put(snapshot.snapshotId, snapshot);
        return snapshot;
    }
    require(snapshotId) {
        const snapshot = this.#store.get(snapshotId);
        if (!snapshot)
            throw new StructureSnapshotNotFoundError(snapshotId);
        return snapshot;
    }
    get size() {
        return this.#store.size;
    }
}
export class StructureDiffStore {
    #store = new BoundedStore(STRUCTURE_SNAPSHOT_LIMITS.storedDiffs);
    add(record) {
        const stored = { ...record, diffId: newId('sd') };
        this.#store.put(stored.diffId, stored);
        return stored;
    }
    require(diffId) {
        const record = this.#store.get(diffId);
        if (!record)
            throw new StructureDiffNotFoundError(diffId);
        return record;
    }
    get size() {
        return this.#store.size;
    }
}
function countUnavailable(item) {
    let count = 0;
    if (item.parent.status === 'unavailable')
        count++;
    if (item.locked.status === 'unavailable')
        count++;
    if (item.hidden.status === 'unavailable')
        count++;
    if (item.appearance.opacity.status === 'unavailable')
        count++;
    if (item.appearance.fill.status === 'unavailable')
        count++;
    if (item.appearance.stroke.status === 'unavailable')
        count++;
    if (item.text !== null && item.text.status === 'unavailable')
        count++;
    return count;
}
export function summarizeStructureSnapshot(snapshot) {
    let unavailableAttributeCount = 0;
    for (const item of snapshot.items)
        unavailableAttributeCount += countUnavailable(item);
    return {
        snapshotId: snapshot.snapshotId,
        document: snapshot.document,
        capturedAt: snapshot.capturedAt,
        itemCount: snapshot.items.length,
        artboardCount: snapshot.artboards.length,
        unavailableAttributeCount,
        snapshotDigest: snapshot.scan.snapshotDigest,
        complete: true,
        retention: STRUCTURE_RETENTION,
    };
}
export function sameDocumentLineage(base, target) {
    if (base.path !== null || target.path !== null)
        return base.path === target.path;
    return base.name === target.name;
}
function normalizeDifference(left, right) {
    return Number(Math.abs(left - right).toFixed(TOLERANCE_NORMALIZATION_DIGITS));
}
function withinTolerance(left, right, tolerancePt) {
    return normalizeDifference(left, right) <= tolerancePt;
}
function roundDelta(value) {
    const rounded = Number(value.toFixed(TOLERANCE_NORMALIZATION_DIGITS));
    return rounded === 0 ? 0 : rounded;
}
function sameBounds(left, right, tolerancePt) {
    for (let index = 0; index < 4; index++) {
        if (!withinTolerance(left[index], right[index], tolerancePt))
            return false;
    }
    return true;
}
function sameValue(left, right, tolerancePt) {
    if (typeof left === 'number' && typeof right === 'number')
        return withinTolerance(left, right, tolerancePt);
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
            return false;
        for (let index = 0; index < left.length; index++) {
            if (!sameValue(left[index], right[index], tolerancePt))
                return false;
        }
        return true;
    }
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        if (leftKeys.length !== rightKeys.length)
            return false;
        for (let index = 0; index < leftKeys.length; index++) {
            const key = leftKeys[index];
            if (key !== rightKeys[index])
                return false;
            if (!sameValue(left[key], right[key], tolerancePt)) {
                return false;
            }
        }
        return true;
    }
    return left === right;
}
function isUnavailable(value) {
    return value !== null && value.status === 'unavailable';
}
function longestIncreasingSubsequence(sequence) {
    const tailIndices = [];
    const previous = new Array(sequence.length).fill(-1);
    for (let index = 0; index < sequence.length; index++) {
        const value = sequence[index];
        let low = 0;
        let high = tailIndices.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (sequence[tailIndices[middle]] < value)
                low = middle + 1;
            else
                high = middle;
        }
        previous[index] = low > 0 ? tailIndices[low - 1] : -1;
        tailIndices[low] = index;
    }
    const members = new Set();
    let cursor = tailIndices.length > 0 ? tailIndices[tailIndices.length - 1] : -1;
    while (cursor !== -1) {
        members.add(cursor);
        cursor = previous[cursor];
    }
    return members;
}
const MOVE_ONLY_FIELDS = new Set(['position', 'layer', 'parent', 'order']);
function compareItems(before, after, orderChanged, tolerancePt) {
    const changes = [];
    if (before.type !== after.type) {
        changes.push({ category: 'attributes', field: 'type', status: 'changed', before: before.type, after: after.type });
    }
    if (before.name !== after.name) {
        changes.push({ category: 'attributes', field: 'name', status: 'changed', before: before.name, after: after.name });
    }
    if (!sameBounds(before.bounds, after.bounds, tolerancePt)) {
        const sameWidth = withinTolerance(before.bounds[2] - before.bounds[0], after.bounds[2] - after.bounds[0], tolerancePt);
        const sameHeight = withinTolerance(before.bounds[1] - before.bounds[3], after.bounds[1] - after.bounds[3], tolerancePt);
        if (sameWidth && sameHeight) {
            changes.push({
                category: 'bounds',
                field: 'position',
                status: 'changed',
                before: before.bounds,
                after: after.bounds,
                delta: { dx: roundDelta(after.bounds[0] - before.bounds[0]), dy: roundDelta(after.bounds[1] - before.bounds[1]) },
            });
        }
        else {
            changes.push({ category: 'bounds', field: 'bounds', status: 'changed', before: before.bounds, after: after.bounds });
        }
    }
    else if (!sameBounds(before.visibleBounds, after.visibleBounds, tolerancePt)) {
        changes.push({
            category: 'bounds',
            field: 'visibleBounds',
            status: 'changed',
            before: before.visibleBounds,
            after: after.visibleBounds,
        });
    }
    const styleFields = ['opacity', 'fill', 'stroke'];
    for (const field of styleFields) {
        const left = before.appearance[field];
        const right = after.appearance[field];
        if (isUnavailable(left) || isUnavailable(right)) {
            changes.push({
                category: 'style', field, status: 'indeterminate', reason: 'attribute_unavailable', before: left, after: right,
            });
        }
        else if (!sameValue(left, right, tolerancePt)) {
            changes.push({ category: 'style', field, status: 'changed', before: left, after: right });
        }
    }
    if (before.text !== null || after.text !== null) {
        if (isUnavailable(before.text) || isUnavailable(after.text)) {
            changes.push({
                category: 'text', field: 'text', status: 'indeterminate', reason: 'attribute_unavailable',
                before: before.text, after: after.text,
            });
        }
        else if (before.text === null || after.text === null) {
            changes.push({ category: 'text', field: 'text', status: 'changed', before: before.text, after: after.text });
        }
        else if (before.text.status === 'available' && after.text.status === 'available') {
            const left = before.text.value;
            const right = after.text.value;
            if (left.text !== right.text || left.totalCharacters !== right.totalCharacters) {
                changes.push({ category: 'text', field: 'text', status: 'changed', before: before.text, after: after.text });
            }
            else if (left.truncated || right.truncated) {
                changes.push({
                    category: 'text', field: 'text', status: 'indeterminate', reason: 'text_truncated',
                    before: before.text, after: after.text,
                });
            }
        }
    }
    if (before.layer.name !== after.layer.name || !sameValue(before.layer.path, after.layer.path, 0)) {
        changes.push({ category: 'hierarchy', field: 'layer', status: 'changed', before: before.layer, after: after.layer });
    }
    if (isUnavailable(before.parent) || isUnavailable(after.parent)) {
        changes.push({
            category: 'hierarchy', field: 'parent', status: 'indeterminate', reason: 'attribute_unavailable',
            before: before.parent, after: after.parent,
        });
    }
    else if (!sameValue(before.parent, after.parent, 0)) {
        changes.push({ category: 'hierarchy', field: 'parent', status: 'changed', before: before.parent, after: after.parent });
    }
    if (orderChanged) {
        changes.push({
            category: 'hierarchy',
            field: 'order',
            status: 'changed',
            before: { documentIndex: before.documentIndex },
            after: { documentIndex: after.documentIndex },
        });
    }
    if (isUnavailable(before.locked) || isUnavailable(after.locked)) {
        changes.push({
            category: 'attributes', field: 'locked', status: 'indeterminate', reason: 'attribute_unavailable',
            before: before.locked, after: after.locked,
        });
    }
    else if (!sameValue(before.locked, after.locked, 0)) {
        changes.push({ category: 'attributes', field: 'locked', status: 'changed', before: before.locked, after: after.locked });
    }
    if (isUnavailable(before.hidden) || isUnavailable(after.hidden)) {
        changes.push({
            category: 'attributes', field: 'hidden', status: 'indeterminate', reason: 'attribute_unavailable',
            before: before.hidden, after: after.hidden,
        });
    }
    else if (!sameValue(before.hidden, after.hidden, 0)) {
        changes.push({ category: 'attributes', field: 'hidden', status: 'changed', before: before.hidden, after: after.hidden });
    }
    return changes;
}
function classify(changes) {
    let sawChanged = false;
    let moveOnly = true;
    for (const change of changes) {
        if (change.status === 'changed') {
            sawChanged = true;
            if (!MOVE_ONLY_FIELDS.has(change.field))
                moveOnly = false;
        }
    }
    if (!sawChanged)
        return 'indeterminate';
    return moveOnly ? 'moved' : 'changed';
}
function itemReference(item) {
    return { type: item.type, name: item.name, layer: item.layer, bounds: item.bounds };
}
function compareDocuments(base, target, tolerancePt) {
    const changes = [];
    for (const field of ['name', 'path', 'colorSpace']) {
        if (base.document[field] !== target.document[field]) {
            changes.push({ scope: 'document', field, status: 'changed', before: base.document[field], after: target.document[field] });
        }
    }
    const count = Math.max(base.artboards.length, target.artboards.length);
    for (let index = 0; index < count; index++) {
        const before = base.artboards[index] ?? null;
        const after = target.artboards[index] ?? null;
        if (before === null && after === null)
            continue;
        if (before === null)
            changes.push({ scope: 'artboard', index, status: 'added', before, after });
        else if (after === null)
            changes.push({ scope: 'artboard', index, status: 'removed', before, after });
        else if (before.name !== after.name || !sameBounds(before.bounds, after.bounds, tolerancePt)) {
            changes.push({ scope: 'artboard', index, status: 'changed', before, after });
        }
    }
    return changes;
}
export function computeStructureDiff(input) {
    const { base, target, tolerancePt } = input;
    if (!Number.isFinite(tolerancePt) || tolerancePt < 0 || tolerancePt > STRUCTURE_DIFF_MAX_TOLERANCE_PT) {
        throw new RangeError(`tolerancePt must be a finite number within 0..${STRUCTURE_DIFF_MAX_TOLERANCE_PT}.`);
    }
    if (!sameDocumentLineage(base.document, target.document)) {
        throw new StructureSnapshotDocumentMismatchError(base.document.key, target.document.key);
    }
    const baseByUuid = new Map();
    for (const item of base.items)
        baseByUuid.set(item.uuid, item);
    const targetByUuid = new Map();
    for (const item of target.items)
        targetByUuid.set(item.uuid, item);
    let inScope = () => true;
    if (input.scope.mode === 'objects') {
        const scoped = new Set();
        for (const uuid of input.scope.uuids) {
            if (!baseByUuid.has(uuid) && !targetByUuid.has(uuid))
                throw new ObjectNotFoundError(uuid);
            scoped.add(uuid);
        }
        inScope = (uuid) => scoped.has(uuid);
    }
    const commonBaseOrder = [];
    for (const item of base.items)
        if (targetByUuid.has(item.uuid))
            commonBaseOrder.push(item);
    const targetRank = new Map();
    let rank = 0;
    for (const item of target.items)
        if (baseByUuid.has(item.uuid))
            targetRank.set(item.uuid, rank++);
    const stableMembers = longestIncreasingSubsequence(commonBaseOrder.map((item) => targetRank.get(item.uuid)));
    const orderChangedUuids = new Set();
    commonBaseOrder.forEach((item, index) => {
        if (!stableMembers.has(index))
            orderChangedUuids.add(item.uuid);
    });
    const summary = {
        baseItemCount: base.items.length,
        targetItemCount: target.items.length,
        comparedItemCount: 0,
        added: 0,
        removed: 0,
        moved: 0,
        changed: 0,
        indeterminate: 0,
        partiallyIndeterminate: 0,
        unchanged: 0,
        entryCount: 0,
        documentChangeCount: 0,
        byCategory: { bounds: 0, style: 0, text: 0, hierarchy: 0, attributes: 0 },
    };
    const entries = [];
    for (const item of base.items) {
        if (targetByUuid.has(item.uuid) || !inScope(item.uuid))
            continue;
        summary.comparedItemCount++;
        summary.removed++;
        entries.push({ kind: 'removed', uuid: item.uuid, item: itemReference(item) });
    }
    for (const after of target.items) {
        if (!inScope(after.uuid))
            continue;
        summary.comparedItemCount++;
        const before = baseByUuid.get(after.uuid);
        if (!before) {
            summary.added++;
            entries.push({ kind: 'added', uuid: after.uuid, item: itemReference(after) });
            continue;
        }
        const changes = compareItems(before, after, orderChangedUuids.has(after.uuid), tolerancePt);
        if (changes.length === 0) {
            summary.unchanged++;
            continue;
        }
        const kind = classify(changes);
        summary[kind]++;
        const categories = new Set();
        let hasIndeterminate = false;
        for (const change of changes) {
            categories.add(change.category);
            if (change.status === 'indeterminate')
                hasIndeterminate = true;
        }
        if (hasIndeterminate && kind !== 'indeterminate')
            summary.partiallyIndeterminate++;
        for (const category of categories)
            summary.byCategory[category]++;
        entries.push({ kind, uuid: after.uuid, type: after.type, name: after.name, changes });
    }
    summary.entryCount = entries.length;
    const documentChanges = compareDocuments(base, target, tolerancePt);
    summary.documentChangeCount = documentChanges.length;
    return {
        computedAt: input.computedAt,
        document: target.document,
        tolerancePt,
        base: { snapshotId: base.snapshotId, documentKey: base.document.key, capturedAt: base.capturedAt },
        target: {
            snapshotId: target.snapshotId,
            documentKey: target.document.key,
            capturedAt: target.capturedAt,
            mode: input.targetMode,
        },
        scope: input.scope,
        summary,
        documentChanges,
        entries,
    };
}
export function pageStructureDiff(record, offset, limit, signCursor) {
    return (async () => {
        const entries = record.entries.slice(offset, offset + limit);
        const nextOffset = offset + entries.length;
        const { entries: _all, ...head } = record;
        const base = { ...head, limit, entries, retention: STRUCTURE_RETENTION };
        if (nextOffset < record.entries.length) {
            const nextCursor = await signCursor({ version: 1, diffId: record.diffId, offset: nextOffset, entryCount: record.entries.length });
            return { ...base, hasMore: true, nextCursor, complete: false, absenceConclusive: false };
        }
        return { ...base, hasMore: false, nextCursor: null, complete: true, absenceConclusive: true };
    })();
}
export function validateStructureDiffCursor(payload) {
    if (typeof payload !== 'object' || payload === null)
        throw new TypeError('Invalid structure-diff cursor.');
    const record = payload;
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'diffId,entryCount,offset,version')
        throw new TypeError('Invalid structure-diff cursor.');
    if (record.version !== 1 || typeof record.diffId !== 'string' || !isStructureDiffId(record.diffId) ||
        typeof record.offset !== 'number' || !Number.isSafeInteger(record.offset) || record.offset < 1 ||
        typeof record.entryCount !== 'number' || !Number.isSafeInteger(record.entryCount) || record.entryCount < record.offset) {
        throw new TypeError('Invalid structure-diff cursor.');
    }
    return { version: 1, diffId: record.diffId, offset: record.offset, entryCount: record.entryCount };
}
