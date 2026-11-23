#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createRequire } from 'node:module';
import { defaultStateRoot, FileCommandStore } from './command-store.js';
import { ReleaseBarrierStore } from './release-barrier.js';
import { CursorSigner } from './cursor.js';
import { IllustratorOperationsCore } from './illustrator-operations-core.js';
import { OsascriptBridge } from './osascript-bridge.js';
import { createServer } from './server.js';
import { defaultMutationOperationRegistry } from './default-mutation-operation-adapters.js';
import { M6P0RecipeAuthorityStore } from './m6-p0-recipe-store.js';
import { DocumentBackupStore } from './document-backup.js';
import { DocumentExportStore } from './document-export.js';
import { RecipeStore } from './recipe-store.js';
import { SipsImageFileInspector } from './image-file-inspector.js';
import { expectedIllustratorBundleId, OsascriptHostApplicationActivator, OsascriptHostProfileProbe } from './host-profile.js';
import { doctorExitCode, formatDoctorReport, runDoctor } from './doctor.js';
import { HTTP_ENV, resolveStreamableHttpConfig, startStreamableHttpServer } from './http-transport.js';
import { StdioProtocolVersionGate } from './stdio-version-gate.js';
import { CallTimingTransport, callTimingEnabled } from './call-timing.js';
import { resolveIllustratorApplication, STABLE_ILLUSTRATOR_APPLICATION } from './illustrator-application.js';
import { buildWindowsReadOperations } from './windows/read-operations.js';
import { parseWindowsCandidateMutations, WINDOWS_CANDIDATE_MUTATIONS_ENV, WINDOWS_CANDIDATE_OPERATIONS } from './windows/mutation-publication.js';
import { formatSetupCommand, SETUP_USAGE } from './setup-command.js';
async function runDoctorCommand(args) {
    const unknown = args.filter((argument) => argument !== '--json');
    if (unknown.length > 0)
        throw new Error(`Unknown doctor option: ${unknown.join(' ')}. Usage: illustrator-studio-mcp doctor [--json]`);
    const report = await runDoctor();
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
    process.exitCode = doctorExitCode(report);
}
const packageVersion = createRequire(import.meta.url)('../package.json').version;
const USAGE = [
    `Usage: illustrator-studio-mcp [http | doctor [--json] | ${SETUP_USAGE} | --version | --help]`,
    '',
    'Starts the Illustrator Studio MCP server on stdio. No API key is required.',
    '"http" serves the same tools over stateless Streamable HTTP on 127.0.0.1 only;',
    `  it requires ${HTTP_ENV.token} (>= 32 chars) and reads ${HTTP_ENV.port},`,
    `  ${HTTP_ENV.allowedOrigins}. See docs/setup.md.`,
    '"doctor [--json]" prints environment diagnostics without starting the server.',
    '"setup" prints exact-version client commands without reading or changing settings or contacting Illustrator.',
    ...(process.platform === 'win32' ? [
        'Windows: read tools and the published mutation tools (create_rectangle, the text, object and layer operations, create_document / open_document / close_document, and place_image / relink_image); other mutations are not available on Windows yet.',
        `${WINDOWS_CANDIDATE_MUTATIONS_ENV} names additional opt-in candidate mutations (${WINDOWS_CANDIDATE_OPERATIONS.length === 0 ? 'none at present' : `live P0 pending: ${WINDOWS_CANDIDATE_OPERATIONS.join(', ')}`}). A published operation is accepted and ignored.`,
        'Illustrator must already be running alone. ILLUSTRATOR_APPLICATION must be Illustrator.Application.',
        'Optional environment: ILLUSTRATOR_STUDIO_MCP_STATE_DIR (attested private local NTFS directory).',
    ] : [
        `Optional environment: ILLUSTRATOR_APPLICATION (default "${STABLE_ILLUSTRATOR_APPLICATION}"; a LaunchServices`,
        '  name is refused while stable and Beta run together), ILLUSTRATOR_STUDIO_MCP_STATE_DIR.',
    ]),
].join('\n');
function handleCliFlags(argv) {
    if (argv.length === 0)
        return false;
    if (argv.length === 1 && argv[0] === '--version') {
        process.stdout.write(`${packageVersion}\n`);
        return true;
    }
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
        process.stdout.write(`${USAGE}\n`);
        return true;
    }
    throw new Error(`Unknown arguments: ${argv.join(' ')}\n${USAGE}`);
}
function buildOperations() {
    if (process.platform === 'win32') {
        const publication = parseWindowsCandidateMutations(process.env);
        return { ...buildWindowsReadOperations(undefined, publication), windowsMutationTools: publication.tools };
    }
    const stateRoot = defaultStateRoot();
    const mutationAdapters = defaultMutationOperationRegistry();
    const application = resolveIllustratorApplication({ env: process.env.ILLUSTRATOR_APPLICATION });
    for (const warning of application.warnings)
        process.stderr.write(`illustrator-studio-mcp: warning: ${warning}\n`);
    const commandStore = new FileCommandStore(stateRoot, { registry: mutationAdapters });
    const barrierStore = new ReleaseBarrierStore(stateRoot, { legacySources: () => bridge.legacyBarrierSources() });
    const bridge = new OsascriptBridge(application.application, commandStore, undefined, mutationAdapters, undefined, undefined, { barrierStore });
    const operations = new IllustratorOperationsCore(bridge, new CursorSigner(stateRoot), mutationAdapters, new M6P0RecipeAuthorityStore(stateRoot), new SipsImageFileInspector(), new DocumentBackupStore(stateRoot), new RecipeStore(stateRoot), new DocumentExportStore(stateRoot), new OsascriptHostProfileProbe(expectedIllustratorBundleId(application.application)), undefined, undefined, undefined, undefined, undefined, undefined, undefined, new OsascriptHostApplicationActivator(expectedIllustratorBundleId(application.application)));
    return { operations, mutationAdapters };
}
async function runHttpCommand(args) {
    if (args.length > 0)
        throw new Error(`Unknown http option: ${args.join(' ')}. Usage: illustrator-studio-mcp http`);
    const config = resolveStreamableHttpConfig(process.env);
    const { operations, mutationAdapters, windowsMutationTools } = buildOperations();
    const server = await startStreamableHttpServer({
        config,
        createMcpServer: () => createServer(operations, mutationAdapters, { windowsReadOnly: process.platform === 'win32', ...(windowsMutationTools ? { windowsMutationTools } : {}) }),
        onRejected: (rejection) => {
            process.stderr.write(`illustrator-studio-mcp: http request rejected status=${rejection.status} reason=${rejection.reason}\n`);
        },
        onError: (error) => {
            process.stderr.write(`illustrator-studio-mcp: http transport error: ${error.message}\n`);
        },
    });
    process.stderr.write(`illustrator-studio-mcp: streamable HTTP listening on ${server.url} (stateless, POST only, bearer token required)\n`);
    const shutdown = (signal) => {
        process.stderr.write(`illustrator-studio-mcp: ${signal} received, closing HTTP listener\n`);
        server.close().then(() => { process.exitCode = 0; }, (error) => {
            process.stderr.write(`illustrator-studio-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}
async function main() {
    const [subcommand, ...rest] = process.argv.slice(2);
    if (subcommand === 'setup') {
        process.stdout.write(formatSetupCommand(packageVersion, rest));
        return;
    }
    if (subcommand === 'doctor') {
        await runDoctorCommand(rest);
        return;
    }
    if (subcommand !== 'http' && handleCliFlags(process.argv.slice(2)))
        return;
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
        throw new Error('The bridge supports macOS and Windows (read-only).');
    }
    if (subcommand === 'http') {
        await runHttpCommand(rest);
        return;
    }
    const { operations, mutationAdapters, windowsMutationTools } = buildOperations();
    serveStdio(() => createServer(operations, mutationAdapters, { windowsReadOnly: process.platform === 'win32', ...(windowsMutationTools ? { windowsMutationTools } : {}) }), {
        transport: callTimingEnabled()
            ? new CallTimingTransport(new StdioProtocolVersionGate(new StdioServerTransport()))
            : new StdioProtocolVersionGate(new StdioServerTransport()),
    });
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`illustrator-studio-mcp: ${message}\n`);
    process.exitCode = 1;
});
