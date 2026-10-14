import { WINDOWS_READ_ONLY_NOTICE } from './com-transport.js';
export const WINDOWS_UNAVAILABLE_READ_TOOLS = new Set([
    'illustrator_render_artboards',
    'illustrator_extract_text',
]);
export const WINDOWS_IMAGE_PREFLIGHT_NOTE = ' On Windows this was measured only with Illustrator in the foreground in an unlocked console session; background and locked sessions are unmeasured.' +
    ' Linked images are checked in one attribute batch before content inspection (at most 50 unique paths per request); fetch-risk or unreadable attributes refuse content access. OneDrive Personal Files On-Demand is measured; RECALL_ON_OPEN, other providers and external concurrent writers are unsupported. The batch costs about one second per nonempty request.';
export const WINDOWS_MUTATION_CANDIDATE_NOTICE = 'Windows candidate mutation (explicit opt-in, live P0 pending): refused unless Illustrator is frontmost with no modal dialog, in an unlocked console session with a single instance.';
export const WINDOWS_SERVER_INSTRUCTIONS = `${WINDOWS_READ_ONLY_NOTICE} Only read tools and read-command reconciliation are registered. ` +
    'Call tools one at a time. An indeterminate read blocks all host access until illustrator_reconcile resolves it. ' +
    'Illustrator must already be running alone in an unlocked local console session. Object UUID pagination, structure diff, edit-session and recipe listing, recipe planning and display-spacing analysis are available. Display-spacing outline analysis needs Illustrator frontmost, opens one scratch document and closes it without saving. PNG preview requires Illustrator frontmost and an unsaved document. ' +
    'Color usage search and color replacement planning require Illustrator foreground in that unlocked local session. On Windows, color replacement is plan-only: it returns a proposed batch request, but mutation tools (including illustrator_mutate_batch) are unavailable, so nothing can be applied. Other excluded reads remain unavailable.';
export function windowsServerInstructions(mutationTools) {
    return mutationTools.size === 0 ? WINDOWS_SERVER_INSTRUCTIONS
        : `${WINDOWS_SERVER_INSTRUCTIONS} Opt-in candidate mutation tools registered: ${[...mutationTools].sort().join(', ')}. ` +
            'They require Illustrator frontmost with no modal dialog open, and apply only to disposable documents until live P0 is published.';
}
export function installWindowsReadOnlyRegistration(server, mutationTools = new Set()) {
    const register = server.registerTool.bind(server);
    server.registerTool = ((name, config, callback) => {
        if (mutationTools.has(name)) {
            return register(name, { ...config, description: `${config.description ?? ''} ${WINDOWS_MUTATION_CANDIDATE_NOTICE}` }, callback);
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
