import { realpath as realpathCallback } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { ExportPreconditionError } from '../document-export.js';
import { ObservationHelperError } from './observation-helper.js';
import { buildUnobservableRefusal, judgeObservation, } from './output-dir-rule.js';
import { measureWindowsDuration } from './perf-probe.js';
const MARKER_TABLE = {
    output_dir_missing: true,
    output_dir_alias: true,
    output_dir_reparse_or_cloud: true,
    output_dir_unobservable: true,
    output_dir_not_local_ntfs: true,
    output_dir_in_state_root: true,
    output_is_source: true,
    staging_path_too_long: true,
    output_dir_not_writable: true,
    output_dir_shared_writable: true,
    output_dir_acl_unobservable: true,
    output_dir_link_unsupported: true,
    output_dir_flush_unsupported: true,
    output_dir_changed: true,
    document_dir_shared_writable: true,
    document_dir_acl_unobservable: true,
    output_exists: true,
    output_cross_device: true,
    empty: true,
    unc_or_device: true,
    root_relative: true,
    drive_relative: true,
    not_drive_absolute: true,
    no_file_name: true,
    empty_component: true,
    dot_component: true,
    forbidden_character: true,
    control_character: true,
    trailing_space_or_dot: true,
    reserved_name: true,
    alternate_data_stream: true,
    path_too_long: true,
    wrong_extension: true,
    onedrive_output: true,
};
export const WINDOWS_OUTPUT_DIR_MARKERS = Object.freeze(Object.keys(MARKER_TABLE));
export const OUTPUT_DIR_PRE_LINK_STAGE = 'pre_link_check';
export class WindowsOutputDirectoryError extends Error {
    code;
    kind;
    point;
    afterHost;
    publicReason;
    stage;
    details;
    constructor(message, failure) {
        super(message);
        this.name = 'WindowsOutputDirectoryError';
        this.code = failure.code;
        this.kind = failure.kind;
        this.point = failure.point;
        this.afterHost = failure.afterHost;
        this.publicReason = failure.publicReason;
        this.stage = failure.stage;
        this.details = failure.details;
    }
}
export class WindowsOutputDirectoryRejection extends ExportPreconditionError {
    code;
    kind = 'output';
    point;
    afterHost = false;
    publicReason;
    stage = null;
    details;
    constructor(reason, message, failure) {
        super(reason, message);
        this.name = 'WindowsOutputDirectoryRejection';
        this.code = failure.code;
        this.point = failure.point;
        this.publicReason = reason;
        this.details = failure.details;
    }
}
export function outputDirectoryRejection(code, point, text, reason = 'output_path_invalid', extra = {}) {
    return new WindowsOutputDirectoryRejection(reason, `[${code}] ${text}`, { code, point, details: { code, ...extra } });
}
function detailsOf(refusal) {
    return {
        code: refusal.code,
        path: refusal.path,
        ...(refusal.detail === undefined ? {} : { detail: refusal.detail }),
        ...(refusal.rule === undefined ? {} : { rule: refusal.rule }),
    };
}
export function errorForRefusal(refusal) {
    const details = detailsOf(refusal);
    if (refusal.afterHost) {
        return new WindowsOutputDirectoryError(refusal.message, {
            code: refusal.code, kind: refusal.kind, point: refusal.point, afterHost: true,
            publicReason: 'output_verification_failed', stage: OUTPUT_DIR_PRE_LINK_STAGE, details,
        });
    }
    if (refusal.kind === 'output') {
        return new WindowsOutputDirectoryRejection('output_path_invalid', refusal.message, { code: refusal.code, point: refusal.point, details });
    }
    return new WindowsOutputDirectoryError(refusal.message, {
        code: refusal.code, kind: refusal.kind, point: refusal.point, afterHost: false,
        publicReason: refusal.publicReason ?? 'document_not_admitted', stage: null, details,
    });
}
const PHASES = Object.freeze({
    preflight: 'win.output_dir.preflight',
    beforeHost: 'win.output_dir.before_host',
    afterStaging: 'win.output_dir.after_staging',
    beforeLink: 'win.output_dir.before_link',
});
export function directoryChainOf(directory) {
    const { root } = win32.parse(directory);
    if (!/^[A-Za-z]:\\$/u.test(root))
        throw new TypeError(`The directory must be an absolute drive path: ${directory}`);
    const parts = directory.slice(root.length).split('\\');
    if (parts.length === 1 && parts[0] === '')
        return [root];
    const chain = [root];
    let current = root.slice(0, -1);
    for (const part of parts) {
        if (part === '' || part === '.' || part === '..')
            throw new TypeError(`The directory must be a normalized path: ${directory}`);
        current = `${current}\\${part}`;
        chain.push(current);
    }
    return chain;
}
function assertRequest(request) {
    const { kind, point, staging } = request;
    const files = request.files?.length ?? 0;
    if (kind === 'document') {
        if (point !== 'preflight' && point !== 'beforeHost')
            throw new TypeError(`The document kind has no point ${point}.`);
        if (staging !== undefined || files === 0)
            throw new TypeError('The document kind needs the document file and no staging directory.');
    }
    else if (point === 'preflight' || point === 'beforeHost') {
        if (staging !== undefined || files !== 0)
            throw new TypeError(`Point ${point} has no staging directory and no files.`);
    }
    else if (point === 'afterStaging') {
        if (staging === undefined || files !== 0)
            throw new TypeError('Point afterStaging needs the staging directory and no files.');
    }
    else if (staging === undefined || files === 0) {
        throw new TypeError('Point beforeLink needs the staging directory and the staged files.');
    }
}
const nodeLstat = async (path) => {
    try {
        const stat = await lstat(path, { bigint: true });
        return { dev: stat.dev, ino: stat.ino, isSymbolicLink: stat.isSymbolicLink() };
    }
    catch {
        return null;
    }
};
const nodeRealpath = (path) => new Promise((resolve, reject) => realpathCallback.native(path, (error, resolved) => (error === null ? resolve(resolved) : reject(error))));
export function createOutputDirectoryGuard(options) {
    const { helper } = options;
    const observeNode = options.lstat ?? nodeLstat;
    const resolveReal = options.realpath ?? nodeRealpath;
    async function observeAndJudge(request) {
        const chain = directoryChainOf(request.parent);
        const staging = request.staging;
        const files = request.files ?? [];
        const paths = [...chain, ...(staging === undefined ? [] : [staging]), ...files];
        const nodeBefore = await Promise.all(paths.map(observeNode));
        let helperObservation;
        try {
            helperObservation = await helper.observe(paths);
        }
        catch (error) {
            if (error instanceof ObservationHelperError)
                return buildUnobservableRefusal(request.kind, request.point, request.parent, error.code);
            throw error;
        }
        const [nodeAfter, parentRealpath] = await Promise.all([
            Promise.all(paths.map(observeNode)),
            resolveReal(request.parent).catch(() => ''),
        ]);
        return judgeObservation({
            kind: request.kind,
            point: request.point,
            chain,
            ...(staging === undefined ? {} : { staging }),
            ...(files.length === 0 ? {} : { files }),
            helper: helperObservation,
            nodeBefore,
            nodeAfter,
            parentRealpath,
        });
    }
    const guard = {
        async judge(request) {
            assertRequest(request);
            return await measureWindowsDuration(PHASES[request.point], () => observeAndJudge(request), options.observer);
        },
        async check(request) {
            const verdict = await guard.judge(request);
            if (!verdict.ok)
                throw errorForRefusal(verdict);
        },
    };
    return guard;
}
