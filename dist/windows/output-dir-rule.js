import { windowsPathKey } from './document-path.js';
import { FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN, FILE_ATTRIBUTE_REPARSE_POINT, } from './image-reparse-gate.js';
export const ACCESS_BIT = Object.freeze({
    WRITE_DATA: 0x2,
    APPEND_DATA: 0x4,
    WRITE_EA: 0x10,
    DELETE_CHILD: 0x40,
    WRITE_ATTRIBUTES: 0x100,
    DELETE: 0x10000,
    WRITE_DAC: 0x40000,
    WRITE_OWNER: 0x80000,
    GENERIC_ALL: 0x10000000,
    GENERIC_WRITE: 0x40000000,
});
const FILE_ALL_ACCESS = 0x1f01ff;
const FILE_GENERIC_WRITE = 0x120116;
const ACE_OBJECT_INHERIT = 0x1;
const ACE_CONTAINER_INHERIT = 0x2;
const ACE_INHERIT_ONLY = 0x8;
const ACE_INHERITED = 0x10;
export const WELL_KNOWN_SID = Object.freeze({
    SYSTEM: 'S-1-5-18',
    ADMINISTRATORS: 'S-1-5-32-544',
    TRUSTED_INSTALLER: 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',
    CREATOR_OWNER: 'S-1-3-0',
    OWNER_RIGHTS: 'S-1-3-4',
});
const SID_NAMES = new Map([
    ['S-1-1-0', 'Everyone'],
    ['S-1-5-4', 'INTERACTIVE'],
    ['S-1-5-11', 'Authenticated Users'],
    ['S-1-5-32-545', 'Users'],
    ['S-1-5-32-546', 'Guests'],
    ['S-1-5-32-547', 'Power Users'],
    ['S-1-3-4', 'OWNER RIGHTS'],
]);
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_PINNED = 0x80000;
const FILE_ATTRIBUTE_UNPINNED = 0x100000;
export const OUTPUT_DIR_DISQUALIFYING_ATTRIBUTES = Object.freeze([
    ['ReparsePoint', FILE_ATTRIBUTE_REPARSE_POINT],
    ['Offline', FILE_ATTRIBUTE_OFFLINE],
    ['RecallOnOpen', FILE_ATTRIBUTE_RECALL_ON_OPEN],
    ['Pinned', FILE_ATTRIBUTE_PINNED],
    ['Unpinned', FILE_ATTRIBUTE_UNPINNED],
    ['RecallOnDataAccess', FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS],
]);
const RIGHT_NAMES = [
    ['DELETE', ACCESS_BIT.DELETE],
    ['DELETE_CHILD', ACCESS_BIT.DELETE_CHILD],
    ['WRITE_DAC', ACCESS_BIT.WRITE_DAC],
    ['WRITE_OWNER', ACCESS_BIT.WRITE_OWNER],
    ['WRITE_DATA|ADD_FILE', ACCESS_BIT.WRITE_DATA],
    ['APPEND_DATA|ADD_SUBDIRECTORY', ACCESS_BIT.APPEND_DATA],
    ['WRITE_ATTRIBUTES', ACCESS_BIT.WRITE_ATTRIBUTES],
    ['WRITE_EA', ACCESS_BIT.WRITE_EA],
];
const DAC = ACCESS_BIT.WRITE_DAC | ACCESS_BIT.WRITE_OWNER;
const ADD = ACCESS_BIT.WRITE_DATA | ACCESS_BIT.APPEND_DATA;
const FILE_WRITE = ACCESS_BIT.WRITE_DATA | ACCESS_BIT.APPEND_DATA | ACCESS_BIT.WRITE_ATTRIBUTES | ACCESS_BIT.WRITE_EA;
export const ACL_RULE = Object.freeze({
    root: { self: DAC | ACCESS_BIT.DELETE_CHILD },
    ancestor: { self: DAC | ACCESS_BIT.DELETE_CHILD | ACCESS_BIT.DELETE },
    parent: {
        self: DAC | ACCESS_BIT.DELETE_CHILD | ACCESS_BIT.DELETE | ADD,
        containerInherit: DAC | ACCESS_BIT.DELETE_CHILD | ACCESS_BIT.DELETE | ADD,
        objectInherit: DAC | ACCESS_BIT.DELETE_CHILD | ACCESS_BIT.DELETE | FILE_WRITE,
    },
    parentRoot: {
        self: DAC | ACCESS_BIT.DELETE_CHILD | ADD,
        containerInherit: DAC | ACCESS_BIT.DELETE_CHILD | ACCESS_BIT.DELETE | ADD,
        objectInherit: DAC | ACCESS_BIT.DELETE_CHILD | ACCESS_BIT.DELETE | FILE_WRITE,
    },
    file: { self: DAC | ACCESS_BIT.DELETE | FILE_WRITE },
});
const SELF_RULE_ID = {
    root: 'A2',
    ancestor: 'A2/A3',
    parent: 'A2/A3/A4',
    parentRoot: 'A2/A4',
};
export function expandGenericRights(mask) {
    let expanded = mask | 0;
    if (expanded & ACCESS_BIT.GENERIC_ALL)
        expanded |= FILE_ALL_ACCESS;
    if (expanded & ACCESS_BIT.GENERIC_WRITE)
        expanded |= FILE_GENERIC_WRITE;
    return expanded;
}
export function rightNames(mask) {
    return RIGHT_NAMES.filter(([, bit]) => (mask & bit) !== 0).map(([name]) => name);
}
export function evaluateAclObject(object, role, trusted) {
    const unobservable = (reason) => ({ ok: false, unobservable: reason, violations: [] });
    if (object.error !== null)
        return unobservable(`read_failed: ${object.error}`);
    if (object.owner === null)
        return unobservable('owner_unreadable');
    if (object.daclNull === true)
        return unobservable('null_dacl');
    if (object.daclNull !== false)
        return unobservable('dacl_state_unknown');
    const violations = [];
    if (!trusted.has(object.owner)) {
        violations.push({ rule: 'A1', sid: object.owner, rights: ['WRITE_DAC(implicit owner)'], inheritOnly: false, flags: 0, inherited: false });
    }
    const spec = ACL_RULE[role];
    for (const ace of object.aces) {
        if (ace.type === 'AccessDenied')
            continue;
        const sid = ace.sid;
        if (ace.type !== 'AccessAllowed' || sid === null)
            return unobservable(`ace_type_${ace.type}`);
        if (trusted.has(sid))
            continue;
        if (sid === WELL_KNOWN_SID.CREATOR_OWNER)
            continue;
        const mask = expandGenericRights(ace.mask);
        const inheritOnly = (ace.flags & ACE_INHERIT_ONLY) !== 0;
        const hit = (rule, bits) => {
            const found = mask & (bits ?? 0);
            if (found !== 0)
                violations.push({ rule, sid, rights: rightNames(found), inheritOnly, flags: ace.flags, inherited: (ace.flags & ACE_INHERITED) !== 0 });
        };
        if (role === 'file') {
            hit('A7', spec.self);
            continue;
        }
        if (!inheritOnly)
            hit(SELF_RULE_ID[role], spec.self);
        if (role === 'parent' || role === 'parentRoot') {
            if ((ace.flags & ACE_CONTAINER_INHERIT) !== 0)
                hit('A5c', spec.containerInherit);
            if ((ace.flags & ACE_OBJECT_INHERIT) !== 0)
                hit('A5f', spec.objectInherit);
        }
    }
    return { ok: violations.length === 0, unobservable: null, violations };
}
export function publicReasonOf(code, kind) {
    if (kind === 'output' && code.startsWith('document_dir_')) {
        throw new TypeError(`Code ${code} belongs to the document kind, not the output kind.`);
    }
    return kind === 'document' ? 'document_not_admitted' : 'output_path_invalid';
}
function aclCode(kind, family) {
    return kind === 'document' ? `document_dir_${family}` : `output_dir_${family}`;
}
const DECIMAL = /^[0-9]+$/u;
function assertInputShape(input) {
    const { kind, point, chain, staging, files } = input;
    if (chain.length === 0)
        throw new TypeError('The directory chain is empty.');
    const fileCount = files?.length ?? 0;
    if (kind === 'document') {
        if (point !== 'preflight' && point !== 'beforeHost')
            throw new TypeError(`The document kind has no point ${point}.`);
        if (staging !== undefined)
            throw new TypeError('The document kind has no staging directory.');
        if (fileCount === 0)
            throw new TypeError('The document kind needs the document file.');
    }
    else if (point === 'preflight' || point === 'beforeHost') {
        if (staging !== undefined || fileCount !== 0)
            throw new TypeError(`Point ${point} has no staging directory and no files.`);
    }
    else if (point === 'afterStaging') {
        if (staging === undefined || fileCount !== 0)
            throw new TypeError('Point afterStaging needs the staging directory and no files.');
    }
    else if (staging === undefined || fileCount === 0) {
        throw new TypeError('Point beforeLink needs the staging directory and the staged files.');
    }
    const total = chain.length + (staging === undefined ? 0 : 1) + fileCount;
    if (input.nodeBefore.length !== total || input.nodeAfter.length !== total) {
        throw new TypeError(`Node observations must cover ${total} paths, got ${input.nodeBefore.length} and ${input.nodeAfter.length}.`);
    }
    return total;
}
function objectShapeProblem(object) {
    if (object === null || typeof object !== 'object')
        return 'object';
    const value = object;
    if (value.attrs !== null && !Number.isInteger(value.attrs))
        return 'attrs';
    for (const field of ['vol', 'index']) {
        if (value[field] !== null && !(typeof value[field] === 'string' && DECIMAL.test(value[field])))
            return field;
    }
    if (value.owner !== null && typeof value.owner !== 'string')
        return 'owner';
    if (value.daclNull !== null && typeof value.daclNull !== 'boolean')
        return 'daclNull';
    if (value.error !== null && typeof value.error !== 'string')
        return 'error';
    if (!Array.isArray(value.aces))
        return 'aces';
    for (const ace of value.aces) {
        if (ace === null || typeof ace !== 'object')
            return 'ace';
        const entry = ace;
        if (typeof entry.type !== 'string' || !Number.isInteger(entry.mask) || !Number.isInteger(entry.flags))
            return 'ace';
        if (entry.sid !== null && typeof entry.sid !== 'string')
            return 'ace';
    }
    return null;
}
function helperStructureProblem(helper, expected) {
    if (helper === null || typeof helper !== 'object')
        return 'helper_output_invalid';
    if (helper.end !== true)
        return 'helper_output_truncated';
    if (!Array.isArray(helper.objects) || helper.objects.length !== expected || helper.count !== expected)
        return 'helper_output_invalid';
    if (typeof helper.userSid !== 'string' || !helper.userSid.startsWith('S-1-'))
        return 'helper_output_invalid';
    if (helper.drive === null || typeof helper.drive !== 'object')
        return 'helper_output_invalid';
    if (helper.objects.some((object) => objectShapeProblem(object) !== null))
        return 'helper_output_invalid';
    const aces = helper.objects.reduce((sum, object) => sum + object.aces.length, 0);
    if (aces !== helper.aceCount)
        return 'helper_output_truncated';
    return null;
}
function a8Problem(input, paths) {
    for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index];
        const before = input.nodeBefore[index] ?? null;
        const after = input.nodeAfter[index] ?? null;
        const object = input.helper.objects[index];
        if (before === null || after === null || object.error === 'win32_2' || object.error === 'win32_3') {
            return { detail: 'component_missing', path };
        }
        if (before.isSymbolicLink || after.isSymbolicLink) {
            const agreed = before.isSymbolicLink && after.isSymbolicLink && object.attrs !== null
                && (object.attrs & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
            if (!agreed)
                return { detail: 'reparse_swapped', path };
        }
        if (before.dev !== after.dev || before.ino !== after.ino)
            return { detail: 'file_id_changed', path };
        if (object.error === null) {
            if (object.vol === null || object.index === null)
                return { detail: 'file_id_mismatch', path };
            if (BigInt(object.vol) !== before.dev || BigInt(object.index) !== before.ino)
                return { detail: 'file_id_mismatch', path };
        }
    }
    const parent = input.chain[input.chain.length - 1];
    if (windowsPathKey(input.parentRealpath) !== windowsPathKey(parent))
        return { detail: 'realpath_mismatch', path: parent };
    return null;
}
function principalLabel(sid) {
    const name = SID_NAMES.get(sid);
    return name === undefined ? sid : `${name} (${sid})`;
}
export function buildOutputDirRefusal(kind, point, code, path, text, extra = {}) {
    const afterHost = point === 'beforeLink';
    return {
        ok: false,
        code,
        kind,
        point,
        afterHost,
        publicReason: afterHost ? null : publicReasonOf(code, kind),
        message: `[${code}] ${path}: ${text}`,
        path,
        ...extra,
    };
}
export function buildUnobservableRefusal(kind, point, path, detail) {
    return buildOutputDirRefusal(kind, point, aclCode(kind, 'acl_unobservable'), path, detail, { detail });
}
export function judgeObservation(input) {
    const total = assertInputShape(input);
    const { kind, point, chain } = input;
    const paths = [...chain, ...(input.staging === undefined ? [] : [input.staging]), ...(input.files ?? [])];
    const refuse = (code, path, text, extra = {}) => buildOutputDirRefusal(kind, point, code, path, text, extra);
    const unobservable = (path, detail) => buildUnobservableRefusal(kind, point, path, detail);
    const structure = helperStructureProblem(input.helper, total);
    if (structure !== null)
        return unobservable(chain[0], structure);
    const a8 = a8Problem(input, paths);
    if (a8 !== null)
        return unobservable(a8.path, a8.detail);
    const objects = input.helper.objects;
    const directoryCount = chain.length + (input.staging === undefined ? 0 : 1);
    for (let index = 0; index < directoryCount; index += 1) {
        const object = objects[index];
        const path = paths[index];
        if (object.attrs === null)
            return refuse('output_dir_unobservable', path, 'attributes_unreadable', { detail: 'attributes_unreadable' });
        const names = OUTPUT_DIR_DISQUALIFYING_ATTRIBUTES.filter(([, bit]) => (object.attrs & bit) !== 0).map(([name]) => name);
        if (names.length > 0) {
            return refuse('output_dir_reparse_or_cloud', path, names.join(','), { detail: names.join(',') });
        }
        if ((object.attrs & FILE_ATTRIBUTE_DIRECTORY) === 0) {
            return refuse('output_dir_unobservable', path, 'not_a_directory', { detail: 'not_a_directory' });
        }
    }
    const drive = input.helper.drive;
    if (typeof drive.error === 'string' || typeof drive.type !== 'string' || typeof drive.format !== 'string') {
        return refuse('output_dir_unobservable', chain[0], 'drive_unreadable', { detail: 'drive_unreadable' });
    }
    if (drive.type !== 'Fixed' || drive.format !== 'NTFS') {
        const detail = `${drive.type}/${drive.format}`;
        return refuse('output_dir_not_local_ntfs', chain[0], detail, { detail });
    }
    const trusted = new Set([
        input.helper.userSid,
        WELL_KNOWN_SID.SYSTEM,
        WELL_KNOWN_SID.ADMINISTRATORS,
        WELL_KNOWN_SID.TRUSTED_INSTALLER,
    ]);
    const evaluations = objects.map((object, index) => {
        const role = index < chain.length
            ? (index === chain.length - 1 ? (index === 0 ? 'parentRoot' : 'parent') : index === 0 ? 'root' : 'ancestor')
            : index === chain.length && input.staging !== undefined ? 'parent' : 'file';
        return evaluateAclObject(object, role, trusted);
    });
    const unreadable = evaluations.findIndex((evaluation) => evaluation.unobservable !== null);
    if (unreadable >= 0)
        return unobservable(paths[unreadable], evaluations[unreadable].unobservable);
    const failing = evaluations.findIndex((evaluation) => evaluation.violations.length > 0);
    if (failing >= 0) {
        const { violations } = evaluations[failing];
        const first = violations[0];
        const text = first.rule === 'A1'
            ? `owner ${principalLabel(first.sid)} is outside the trusted principals`
            : `${principalLabel(first.sid)} may ${first.rights.join('|')}`;
        return refuse(aclCode(kind, 'shared_writable'), paths[failing], text, {
            rule: first.rule,
            principal: first.sid,
            rights: first.rights,
            violations,
        });
    }
    return { ok: true };
}
