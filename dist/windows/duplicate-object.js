import { realpath } from 'node:fs/promises';
import { createDuplicateObjectAdapter, DUPLICATE_OBJECT_SCRIPT } from '../adapters/duplicate-object-adapter.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { assertWindowsMutationAdmission, WindowsMutationAdmissionError } from './mutation-admission.js';
import { windowsProcessEvidence } from './host-channel.js';
import { evaluateHostVersion } from '../host-version-policy.js';
import { windowsCommandRunner } from './powershell-runner.js';
export const WINDOWS_DUPLICATE_CANDIDATE = 'duplicate_object_colour_profile';
export const WINDOWS_DUPLICATE_EXECUTABLE = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Support Files/Contents/Windows/Illustrator.exe';
const hook = '  var sourceBefore = duplicateSnapshot(document, source, params.sourceUuid);';
if (DUPLICATE_OBJECT_SCRIPT.split(hook).length !== 2)
    throw new Error('Windows duplicate source hook changed.');
export const WINDOWS_DUPLICATE_SCRIPT = `
${DUPLICATE_OBJECT_SCRIPT.replace(hook, `
  if (source.typename !== "PathItem" ||
      (source.parent.typename === "GroupItem" && document.documentColorSpace !== DocumentColorSpace.CMYK)) {
    throw mutationError("preflight_failed", "Windows duplicate candidate supports nested CMYK Path and direct-layer CMYK-base Spot Path only; other source kinds/nested RGB remain unmeasured.");
  }
${hook}`)}`;
const base = createDuplicateObjectAdapter();
const hostScriptDigest = canonicalSha256(WINDOWS_DUPLICATE_SCRIPT);
export const WINDOWS_DUPLICATE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: base.operation, validator: base.validator,
    canonicalContractVersion: base.canonical.version, resultSchemaVersion: base.resultSchemaVersion,
    terminalClassifierVersion: base.terminalClassifierVersion, safetyConformanceVersion: base.safetyConformanceVersion,
    errorMappingVersion: base.errorMappingVersion, safetyIdentity: base.safetyRegistrationIdentity, hostScriptDigest,
});
export function createWindowsDuplicateObjectAdapter(options = {}) {
    const run = options.duplicateCommandRunner ?? windowsCommandRunner;
    const resolvePath = options.duplicateRealpath ?? realpath;
    const observe = async () => {
        let output = '';
        await assertWindowsMutationAdmission(async (...args) => {
            const outcome = await run(...args);
            if (outcome.kind === 'exit')
                output = outcome.stdout;
            return outcome;
        });
        const observation = JSON.parse(output);
        const evidence = windowsProcessEvidence(observation.illustratorExecutablePaths, observation.illustratorFileVersions);
        if (evidence === null || evaluateHostVersion('duplicate_object', evidence.fileVersion).status !== 'measured' ||
            (await resolvePath(evidence.executablePath)).toLowerCase() !== (await resolvePath(WINDOWS_DUPLICATE_EXECUTABLE)).toLowerCase()) {
            throw new WindowsMutationAdmissionError('host_state_unknown', 'Colour duplicate requires the stable Illustrator executable at the measured install path on the measured version.');
        }
    };
    const { hostVersionOperation: _policyRow, ...shared } = base;
    return {
        ...shared, adapterIdentity: WINDOWS_DUPLICATE_ADAPTER_IDENTITY, hostScriptDigest,
        tool: { ...base.tool, description: base.tool.description + ' Windows opt-in colour-profile candidate: native F0 measured nested CMYK Path (two ordinary groups) and direct-layer ordinary CMYK-base Spot Path. Stable executable at the measured install path on the measured version (30.8.2), foreground/unlocked local console/no modal. Existing structural limits and strict protected-wire comparisons remain; fixture values are not defaults. Text/image/group sources, nested RGB/Spot and other host states remain unmeasured. Public Windows P0 pending; not enabled by default.' },
        async admit(input) {
            const normalized = base.canonical.normalize(input);
            if (normalized.intent === 'plan')
                await observe();
            return { ...normalized.request, nestedHostReady: true };
        },
        beforeHost: observe,
        buildCommand(input) {
            const command = base.buildCommand(input);
            return command.kind === 'read' ? { ...command, kind: 'read', script: WINDOWS_DUPLICATE_SCRIPT }
                : { ...command, kind: 'mutation', script: WINDOWS_DUPLICATE_SCRIPT, adapterIdentity: WINDOWS_DUPLICATE_ADAPTER_IDENTITY };
        },
    };
}
