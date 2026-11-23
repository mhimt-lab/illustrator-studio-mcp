import { realpath } from 'node:fs/promises';
import { createSetStrokeStyleAdapter, SET_STROKE_STYLE_SCRIPT } from '../adapters/set-stroke-style-adapter.js';
import { canonicalSha256 } from '../mutation-canonical.js';
import { mutationAdapterIdentity } from '../mutation-operation-adapter.js';
import { assertWindowsMutationAdmission, WindowsMutationAdmissionError } from './mutation-admission.js';
import { windowsProcessEvidence } from './host-channel.js';
import { HOST_VERSION_POLICY_JSX, evaluateHostVersion } from '../host-version-policy.js';
import { windowsCommandRunner } from './powershell-runner.js';
export const WINDOWS_STROKE_EXECUTABLE = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Support Files/Contents/Windows/Illustrator.exe';
export const WINDOWS_STROKE_SCRIPT = `
${HOST_VERSION_POLICY_JSX}
(function () {
  var strokeVersionStatus = hostVersionEvaluate("windows_set_stroke_style", String(app.version)).status;
  if (strokeVersionStatus !== "measured") throw new Error("Windows stroke style is not admitted on Illustrator " + String(app.version) + " by the host version policy.");
})();
${SET_STROKE_STYLE_SCRIPT}`;
const base = createSetStrokeStyleAdapter();
const hostScriptDigest = canonicalSha256(WINDOWS_STROKE_SCRIPT);
export const WINDOWS_STROKE_ADAPTER_IDENTITY = mutationAdapterIdentity({
    version: 2, contractVersion: 1, operation: base.operation, validator: base.validator,
    canonicalContractVersion: base.canonical.version, resultSchemaVersion: base.resultSchemaVersion,
    terminalClassifierVersion: base.terminalClassifierVersion, safetyConformanceVersion: base.safetyConformanceVersion,
    errorMappingVersion: base.errorMappingVersion, safetyIdentity: base.safetyRegistrationIdentity, hostScriptDigest,
});
export function createWindowsSetStrokeStyleAdapter(options = {}) {
    const run = options.strokeCommandRunner ?? windowsCommandRunner;
    const resolvePath = options.strokeRealpath ?? realpath;
    return {
        ...base, adapterIdentity: WINDOWS_STROKE_ADAPTER_IDENTITY, hostScriptDigest,
        tool: { ...base.tool, description: base.tool.description + ' Windows: published by default for the stable Illustrator executable at the measured install path, on the measured version (30.8.2) only, foreground in an unlocked local console with no modal and a single instance. Native F0 covered ten stroke tuple families; the public in-memory MCP P0 covered dash plan/apply/replay/inverse. Never-saved one-layer CMYK, open three-point straight path with enabled CMYK fill/stroke only; other versions, executables, geometry, paint and host states remain unmeasured.' },
        beforeHost: async () => {
            let output = '';
            await assertWindowsMutationAdmission(async (...args) => {
                const outcome = await run(...args);
                if (outcome.kind === 'exit')
                    output = outcome.stdout;
                return outcome;
            });
            const observation = JSON.parse(output);
            const evidence = windowsProcessEvidence(observation.illustratorExecutablePaths, observation.illustratorFileVersions);
            if (evidence === null || evaluateHostVersion('windows_set_stroke_style', evidence.fileVersion).status !== 'measured' ||
                (await resolvePath(evidence.executablePath)).toLowerCase() !== (await resolvePath(WINDOWS_STROKE_EXECUTABLE)).toLowerCase()) {
                throw new WindowsMutationAdmissionError('host_state_unknown', 'Stroke style requires the stable Illustrator executable at the measured install path on the measured version.');
            }
        },
        buildCommand(input) {
            const command = base.buildCommand(input);
            return command.kind === 'read' ? { ...command, kind: 'read', script: WINDOWS_STROKE_SCRIPT }
                : { ...command, kind: 'mutation', script: WINDOWS_STROKE_SCRIPT, adapterIdentity: WINDOWS_STROKE_ADAPTER_IDENTITY };
        },
    };
}
