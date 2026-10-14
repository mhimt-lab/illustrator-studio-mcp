import { defaultStateRoot, FileCommandStore } from '../command-store.js';
import { CursorSigner } from '../cursor.js';
import { defaultMutationOperationRegistry } from '../default-mutation-operation-adapters.js';
import { IllustratorOperationsCore } from '../illustrator-operations-core.js';
import { WindowsHostProfileProbe } from './host-profile.js';
import { WindowsImageFileInspector } from './image-file-inspector.js';
import { windowsImagePreflightBatchGate } from './image-preflight-batch-gate.js';
import { WINDOWS_ILLUSTRATOR_APPLICATION, WindowsComTransport, WindowsBridge } from './com-transport.js';
import { WINDOWS_NO_CANDIDATE_MUTATIONS } from './mutation-publication.js';
export function buildWindowsReadOperations(stateRoot = defaultStateRoot(), publication = WINDOWS_NO_CANDIDATE_MUTATIONS, transport = new WindowsComTransport(), hostProfileProbe = new WindowsHostProfileProbe()) {
    const mutationAdapters = defaultMutationOperationRegistry();
    const application = process.env.ILLUSTRATOR_APPLICATION?.trim() || WINDOWS_ILLUSTRATOR_APPLICATION;
    const bridge = new WindowsBridge(application, new FileCommandStore(stateRoot, { registry: mutationAdapters }), mutationAdapters, transport, { mutationAllowlist: publication.adapterIdentities });
    const operations = new IllustratorOperationsCore(bridge, new CursorSigner(stateRoot), mutationAdapters, undefined, new WindowsImageFileInspector(), undefined, undefined, undefined, hostProfileProbe, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, windowsImagePreflightBatchGate());
    return { operations, mutationAdapters, bridge };
}
