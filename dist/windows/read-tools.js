import { WINDOWS_READ_ONLY_NOTICE } from './com-transport.js';
import { WINDOWS_CREATE_LAYER_NAMES_NOTE } from './create-layer.js';
import { WINDOWS_DEFAULT_PUBLISHED_TOOLS } from './mutation-publication.js';
export const WINDOWS_UNAVAILABLE_READ_TOOLS = new Set([
    'illustrator_render_artboards',
    'illustrator_extract_text',
    'illustrator_plan_text_fit',
    'illustrator_plan_text_increment',
    'illustrator_list_variables',
    'illustrator_measure_scale_reference',
]);
export const WINDOWS_IMAGE_PREFLIGHT_NOTE = ' On Windows this was measured only with Illustrator in the foreground in an unlocked console session; background and locked sessions are unmeasured.' +
    ' Linked images are checked in one attribute batch before content inspection (at most 50 unique paths per request); fetch-risk or unreadable attributes refuse content access. OneDrive Personal Files On-Demand is measured; RECALL_ON_OPEN, other providers and external concurrent writers are unsupported. The batch costs about one second per nonempty request.';
export const WINDOWS_MUTATION_CANDIDATE_NOTICE = 'Windows candidate mutation (explicit opt-in, live P0 pending): refused unless Illustrator is frontmost with no modal dialog, in an unlocked console session with a single instance.';
export const WINDOWS_CLOSE_DOCUMENT_SAVED_NOTE = ' In this server illustrator_save_document is registered, so the restriction above does not apply: a document backed by a file is closed, with the file checked before and after the close and nothing saved. A document that has no file on disk is closed as usual.';
export const WINDOWS_MUTATION_PUBLISHED_NOTICE = 'Windows mutation: refused unless Illustrator is frontmost with no modal dialog, in an unlocked console session with a single instance.';
export const WINDOWS_MUTATION_TOOL_NOTES = Object.freeze({
    illustrator_set_text_style: ' On Windows, style.font_post_script_name requires registry/sfnt or Illustrator bundled-list verification and an exact host name match. Unconfirmed names (including variable instances, Adobe Fonts and package-only fonts) are refused before any change; size, tracking, scales and fill are not affected.',
    illustrator_close_document: ' On Windows, only a document that has no file on disk (never saved) can be closed: a document backed by a file is rejected with reason windows_saved_document_unsupported before anything is closed, whatever its saved flag.',
    illustrator_save_document: ' On Windows, a document in a OneDrive folder is never overwritten in place (rejected document_not_admitted with [onedrive_output]; use illustrator_save_document_as to a local folder). The folder the document is in must also be one only you can write to, checked before Illustrator is touched and again just before the save (rejected document_not_admitted with [document_dir_shared_writable] or [document_dir_acl_unobservable]; document folder / 文書のフォルダ): save a copy with illustrator_save_document_as to such a folder, or create a folder directly under your profile and turn its inheritance off. backup_id must come from illustrator_create_backup, which is also an opt-in candidate on Windows. The file revision has a one-second resolution, so a save that leaves the revision unchanged is reported as indeterminate, never as saved. After a timeout or a stopped server, call illustrator_reconcile first (action inspect, then abandon with that command_id and an identical confirm_command_id once it reports canAbandon), then retry with the same backup_id.',
    illustrator_open_document: ' On Windows, path must be a fully qualified local drive path such as C:\\dir\\file.ai with backslash separators. UNC paths (network shares), device paths, alternate data streams, reserved names, paths over 259 characters, paths behind a symbolic link, junction, substituted drive or short name, cloud placeholders (OneDrive files not available offline) and files inside the MCP state root are rejected before Illustrator is contacted; the reason code leads the message as [code]. An already-open file is found case-insensitively.',
    illustrator_create_backup: ' On Windows, backup_root is not accepted: any value is rejected as backup_root_unavailable with [backup_root_unsupported] before Illustrator or the state root is touched, and the backup is always kept in the backups folder of the MCP state root. A document of more than 1,000 items is rejected as document_too_large before anything is copied or opened (the structure stream it would need is not available on Windows yet; tracked in #911); the message names the limit and the ways out: remove items until at most 1,000 remain and save that document under another name (illustrator_save_document_as, or Save As in Illustrator) and back up the new file, or create the backup on macOS. The restore-test copy is opened without alerts; if Illustrator still raises a dialog (for example a missing font), the session stays unresolved: close the dialog on screen, then call illustrator_reconcile_backup. After a timeout, a restart of this server or any other indeterminate result, a command left in flight blocks every later host call ("An unresolved read blocks Windows host access; reconcile it first"): call illustrator_reconcile first (action inspect, then action abandon with that command_id and an identical confirm_command_id once it reports canAbandon), and only then illustrator_reconcile_backup with the backup_id of the unresolved session.',
    illustrator_reconcile_backup: ' On Windows, close_restore_test is refused while a dialog is open in Illustrator: close the dialog on screen first, then call this tool again. If this tool is refused with "An unresolved read blocks Windows host access; reconcile it first" (a command was left in flight, for example when the server stopped during create_backup), call illustrator_reconcile first (action inspect, then abandon with that command_id and an identical confirm_command_id once it reports canAbandon), then call this tool again with the backup_id.',
    illustrator_create_layer: WINDOWS_CREATE_LAYER_NAMES_NOTE,
    illustrator_duplicate_object: ' On Windows, only a layer-direct path without a spot-colour fill can be duplicated: a path inside a group, or one with a spot fill, is refused before any change because the host profile used for those cases is macOS-only.',
});
const WINDOWS_INSTRUCTIONS_COMMON = 'Call tools one at a time. An indeterminate read blocks all host access until illustrator_reconcile resolves it. ' +
    'Illustrator must already be running alone in an unlocked local console session. Object UUID pagination, structure diff, edit-session and recipe listing, recipe planning and display-spacing analysis are available. Display-spacing outline analysis needs Illustrator frontmost, opens one scratch document and closes it without saving. PNG preview requires Illustrator frontmost and an unsaved document. ' +
    'Color usage search and color replacement planning require Illustrator foreground in that unlocked local session. On Windows, color replacement is plan-only: it returns a proposed batch request, but mutation tools (including illustrator_mutate_batch) are unavailable, so nothing can be applied. Other excluded reads remain unavailable.';
export const WINDOWS_SERVER_INSTRUCTIONS = `${WINDOWS_READ_ONLY_NOTICE} Only read tools and read-command reconciliation are registered. ${WINDOWS_INSTRUCTIONS_COMMON}`;
export function windowsServerInstructions(mutationTools) {
    if (mutationTools.size === 0)
        return WINDOWS_SERVER_INSTRUCTIONS;
    const published = [...mutationTools].filter((tool) => WINDOWS_DEFAULT_PUBLISHED_TOOLS.has(tool)).sort();
    const candidates = [...mutationTools].filter((tool) => !WINDOWS_DEFAULT_PUBLISHED_TOOLS.has(tool)).sort();
    const parts = ['Read tools, read-command reconciliation and the Windows mutation tools named below are registered; every other mutation is not available on Windows yet.'];
    if (published.length > 0) {
        parts.push(`Published mutation tools: ${published.join(', ')}. They require Illustrator frontmost with no modal dialog open; ` +
            'an indeterminate result blocks later mutations until illustrator_reconcile resolves it.');
    }
    if (candidates.length > 0) {
        parts.push(`Opt-in candidate mutation tools registered: ${candidates.join(', ')}. ` +
            'They require Illustrator frontmost with no modal dialog open, and apply only to disposable documents until live P0 is published.');
    }
    return `${parts.join(' ')} ${WINDOWS_INSTRUCTIONS_COMMON}`;
}
export function installWindowsReadOnlyRegistration(server, mutationTools = new Set()) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name, config, callback) => {
        if (mutationTools.has(name)) {
            return register(name, { ...config, description: `${config.description ?? ''} ${WINDOWS_DEFAULT_PUBLISHED_TOOLS.has(name) ? WINDOWS_MUTATION_PUBLISHED_NOTICE : WINDOWS_MUTATION_CANDIDATE_NOTICE}${WINDOWS_MUTATION_TOOL_NOTES[name] ?? ''}${name === 'illustrator_close_document' && mutationTools.has('illustrator_save_document') ? WINDOWS_CLOSE_DOCUMENT_SAVED_NOTE : ''}` }, callback);
        }
        const windowsRead = name === 'illustrator_capture_preview';
        if (name !== 'illustrator_reconcile' && !windowsRead &&
            (config.annotations?.readOnlyHint !== true || WINDOWS_UNAVAILABLE_READ_TOOLS.has(name)))
            return undefined;
        const preflightNote = name === 'illustrator_preflight_images' || name === 'illustrator_preflight_print' ? WINDOWS_IMAGE_PREFLIGHT_NOTE : '';
        const planNote = name === 'illustrator_plan_color_replacement'
            ? ' On Windows this tool is plan-only: it returns a proposed batch request, but mutation tools (including illustrator_mutate_batch) are unavailable, so nothing can be applied.' : '';
        const imageNote = name === 'illustrator_compare_images'
            ? ' On Windows, ancestor junctions and symlinks are followed; undetected cloud placeholders may hydrate. Hard-link aliases are accepted. Same-handle double reading detects observed changes but does not guarantee an atomic snapshot or adversarial race safety.' : '';
        const handler = name === 'illustrator_compare_images' ? async (...args) => {
            try {
                return await callback(...args);
            }
            catch (error) {
                if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string')
                    throw error;
                return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code, message: error.message }) }] };
            }
        } : callback;
        return register(name, { ...config, ...(windowsRead ? { annotations: { ...config.annotations, readOnlyHint: true } } : {}),
            description: `${config.description ?? ''} ${WINDOWS_READ_ONLY_NOTICE}${planNote}${imageNote}${preflightNote}` }, handler);
    });
}
