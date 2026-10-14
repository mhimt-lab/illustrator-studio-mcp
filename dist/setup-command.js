const PACKAGE_NAME = 'illustrator-studio-mcp';
const SERVER_NAME = 'illustrator-studio';
export const SETUP_USAGE = 'setup [--client claude-code|codex] [--current <exact-version>] [--previous <exact-version>] [--json]';
export function validateExactVersion(version) {
    const core = '(0|[1-9][0-9]*)';
    const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
    if (!new RegExp(`^${core}\\.${core}\\.${core}(?:-${identifier}(?:\\.${identifier})*)?$`).test(version)) {
        throw new Error('SETUP_EXACT_VERSION_REQUIRED: use an exact release version, not a tag, range, or shell expression.');
    }
    return version;
}
function shellCommand(args) {
    return args.map(arg => /^[A-Za-z0-9_@./:-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}
function registration(client, version) {
    const args = client === 'claude-code'
        ? ['claude', 'mcp', 'add', '--transport', 'stdio', '--scope', 'user', SERVER_NAME]
        : ['codex', 'mcp', 'add', SERVER_NAME];
    return shellCommand([...args, '--', 'npx', '-y', `${PACKAGE_NAME}@${version}`]);
}
export function setupReport(packageVersion, args) {
    const target = validateExactVersion(packageVersion);
    let client, current, previous;
    let json = false;
    const seen = new Set();
    for (let index = 0; index < args.length; index++) {
        const option = args[index];
        if (seen.has(option))
            throw new Error(`SETUP_INVALID_ARGUMENT: duplicate option. Usage: ${SETUP_USAGE}`);
        seen.add(option);
        if (option === '--json') {
            json = true;
            continue;
        }
        if (!['--client', '--current', '--previous'].includes(option))
            throw new Error(`SETUP_INVALID_ARGUMENT. Usage: ${SETUP_USAGE}`);
        const value = args[++index];
        if (value === undefined || value.startsWith('--'))
            throw new Error(`SETUP_ARGUMENT_VALUE_REQUIRED. Usage: ${SETUP_USAGE}`);
        if (option === '--client') {
            if (value !== 'claude-code' && value !== 'codex')
                throw new Error(`SETUP_CLIENT_UNSUPPORTED. Usage: ${SETUP_USAGE}`);
            client = value;
        }
        else if (option === '--current')
            current = validateExactVersion(value);
        else
            previous = validateExactVersion(value);
    }
    previous ??= current;
    const clients = client ? [client] : ['claude-code', 'codex'];
    const commands = clients.map(name => {
        const remove = shellCommand(name === 'claude-code'
            ? ['claude', 'mcp', 'remove', '--scope', 'user', SERVER_NAME]
            : ['codex', 'mcp', 'remove', SERVER_NAME]);
        return {
            client: name,
            inspect: shellCommand([name === 'claude-code' ? 'claude' : 'codex', 'mcp', 'get', SERVER_NAME]),
            register: registration(name, target),
            update: current === undefined ? null : `${remove} && ${registration(name, target)}`,
            rollback: previous === undefined ? null : `${remove} && ${registration(name, previous)}`,
        };
    });
    return { json, report: {
            package: PACKAGE_NAME, server: SERVER_NAME, current: current ?? null, target, previous: previous ?? null,
            versionAuthority: 'running-package', currentAuthority: 'user-provided', readOnly: true,
            replacementScope: 'canonical-default-only',
            doctor: shellCommand(['npx', '-y', `${PACKAGE_NAME}@${target}`, 'doctor']), commands,
        } };
}
export function formatSetupCommand(packageVersion, args) {
    const { json, report } = setupReport(packageVersion, args);
    if (json)
        return `${JSON.stringify(report, null, 2)}\n`;
    return [
        'Read-only setup: no settings changed; no client/server/Illustrator started.',
        `current (provided): ${report.current ?? 'unknown; inspect your client pin'}`,
        `target (running package): ${report.target}`,
        `previous (provided): ${report.previous ?? 'unknown; retain your old exact pin'}`,
        'Inspect the named entry first. Register only if absent; update/rollback replace only that entry.',
        'Replacement commands require the default npx/exact pin with no custom env/args. Preserve customized settings separately.',
        'Resolve pending operations and check downgrade compatibility before replacing a pin.',
        'Commands below are for a macOS POSIX shell; Node.js 20+, npx and the client must be on PATH.',
        ...report.commands.flatMap(command => [
            '', `${command.client}:`, `inspect: ${command.inspect}`, `register: ${command.register}`,
            ...(command.update ? [`update: ${command.update}`] : []),
            ...(command.rollback ? [`rollback: ${command.rollback}`] : []),
        ]),
        '', `After registration/update/rollback, run: ${report.doctor}`,
        'Restart the client and check /mcp separately; configuration storage is not connection evidence.',
        '',
    ].join('\n');
}
