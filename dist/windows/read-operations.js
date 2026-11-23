import { defaultStateRoot, FileCommandStore } from '../command-store.js';
import { CursorSigner } from '../cursor.js';
import { IllustratorOperationsCore } from '../illustrator-operations-core.js';
import { WindowsHostProfileProbe } from './host-profile.js';
import { windowsOpenPathPolicy } from './document-open-policy.js';
import { createWindowsSavedDocumentCloseRefusal } from './durable-document-ops.js';
import { WINDOWS_DURABLE_FILE_POLICY } from './durable-file-ops.js';
import { WindowsImageFileInspector } from './image-file-inspector.js';
import { windowsImagePreflightBatchGate } from './image-preflight-batch-gate.js';
import { createWindowsMutationOperationRegistry } from './mutation-registry.js';
import { windowsTimingObserverFromEnv } from './perf-probe.js';
import { windowsCommandRunner } from './powershell-runner.js';
import { WINDOWS_ILLUSTRATOR_APPLICATION, WindowsComTransport, WindowsBridge } from './com-transport.js';
import { WINDOWS_NO_MUTATIONS } from './mutation-publication.js';
import { WINDOWS_DUPLICATE_CANDIDATE } from './duplicate-object.js';
import { WindowsFontVerifier } from './font-verification.js';
import { WINDOWS_STRUCTURE_READ_MAX_PAGE_ITEMS } from '../structure-read-budget.js';
const SAVE_DOCUMENT_TOOL = 'illustrator_save_document';
export function windowsDurableFilePolicyFor(publication, base = WINDOWS_DURABLE_FILE_POLICY) {
    return publication.tools.has(SAVE_DOCUMENT_TOOL) ? Object.freeze({
        ...base, savedDocumentCloseRefusal: createWindowsSavedDocumentCloseRefusal(true),
    }) : base;
}
export function buildWindowsReadOperations(stateRoot = defaultStateRoot(), publication = WINDOWS_NO_MUTATIONS, transport, hostProfileProbe, openPathPolicy = windowsOpenPathPolicy(), imageAdapterOptions = {}, durableFilePolicyBase = WINDOWS_DURABLE_FILE_POLICY, fontVerifier) {
    const durationObserver = windowsTimingObserverFromEnv();
    const comTransport = transport ?? (durationObserver ? new WindowsComTransport(windowsCommandRunner, { durationObserver }) : new WindowsComTransport());
    const profileProbe = hostProfileProbe ?? (durationObserver ? new WindowsHostProfileProbe(windowsCommandRunner, durationObserver) : new WindowsHostProfileProbe());
    const mutationAdapters = createWindowsMutationOperationRegistry({ ...imageAdapterOptions,
        duplicateColourProfile: publication.operations.includes(WINDOWS_DUPLICATE_CANDIDATE) });
    const application = process.env.ILLUSTRATOR_APPLICATION?.trim() || WINDOWS_ILLUSTRATOR_APPLICATION;
    const bridge = new WindowsBridge(application, new FileCommandStore(stateRoot, { registry: mutationAdapters }), mutationAdapters, comTransport, { mutationAllowlist: publication.adapterIdentities, hostCommandAllowlist: publication.hostCommands });
    const durableFilePolicy = windowsDurableFilePolicyFor(publication, durableFilePolicyBase);
    const operations = new IllustratorOperationsCore(bridge, new CursorSigner(stateRoot), mutationAdapters, undefined, new WindowsImageFileInspector(), undefined, undefined, undefined, profileProbe, undefined, undefined, undefined, fontVerifier ?? new WindowsFontVerifier({ application: () => comTransport.hostChannel.fontApplication(), durationObserver }), undefined, undefined, undefined, undefined, windowsImagePreflightBatchGate(), openPathPolicy, durableFilePolicy, WINDOWS_STRUCTURE_READ_MAX_PAGE_ITEMS);
    return { operations, mutationAdapters, bridge };
}
