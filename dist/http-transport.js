import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createNodeHttpServer, } from 'node:http';
import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport, } from '@modelcontextprotocol/server';
export const HTTP_BIND_ADDRESS = '127.0.0.1';
export const HTTP_DEFAULT_PORT = 3847;
export const HTTP_PATH = '/mcp';
export const HTTP_MIN_TOKEN_LENGTH = 32;
export const HTTP_MAX_BODY_BYTES = 1_048_576;
export const HTTP_REALM = 'illustrator-studio-mcp';
export const HTTP_ENV = {
    token: 'ILLUSTRATOR_STUDIO_MCP_HTTP_TOKEN',
    port: 'ILLUSTRATOR_STUDIO_MCP_HTTP_PORT',
    bind: 'ILLUSTRATOR_STUDIO_MCP_HTTP_BIND',
    allowedOrigins: 'ILLUSTRATOR_STUDIO_MCP_HTTP_ALLOWED_ORIGINS',
};
function isPrintableAscii(value) {
    return /^[\x21-\x7e]+$/.test(value);
}
function parsePort(raw) {
    if (raw === undefined || raw === '')
        return HTTP_DEFAULT_PORT;
    if (!/^\d{1,5}$/.test(raw))
        throw new Error(`${HTTP_ENV.port} must be an integer between 0 and 65535.`);
    const port = Number(raw);
    if (port > 65_535)
        throw new Error(`${HTTP_ENV.port} must be an integer between 0 and 65535.`);
    return port;
}
export function normalizeOrigin(raw) {
    const trimmed = raw.trim().replace(/\/$/, '');
    const failure = new Error(`${HTTP_ENV.allowedOrigins} entries must be absolute origins such as http://127.0.0.1:5173.`);
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw failure;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin.toLowerCase() !== trimmed.toLowerCase()) {
        throw failure;
    }
    return url.origin.toLowerCase();
}
export function resolveStreamableHttpConfig(env = process.env) {
    const bind = env[HTTP_ENV.bind];
    if (bind !== undefined && bind !== '' && bind !== HTTP_BIND_ADDRESS) {
        throw new Error(`${HTTP_ENV.bind} only accepts ${HTTP_BIND_ADDRESS}; remote or wildcard binding is not supported.`);
    }
    const token = env[HTTP_ENV.token];
    if (token === undefined || token === '') {
        throw new Error(`${HTTP_ENV.token} is required; the HTTP transport never starts without a bearer token.`);
    }
    if (token.length < HTTP_MIN_TOKEN_LENGTH || !isPrintableAscii(token)) {
        throw new Error(`${HTTP_ENV.token} must be at least ${HTTP_MIN_TOKEN_LENGTH} printable ASCII characters without whitespace.`);
    }
    const rawOrigins = env[HTTP_ENV.allowedOrigins];
    const allowedOrigins = new Set();
    if (rawOrigins !== undefined && rawOrigins.trim() !== '') {
        for (const entry of rawOrigins.split(',')) {
            if (entry.trim() === '')
                continue;
            allowedOrigins.add(normalizeOrigin(entry));
        }
    }
    return {
        bindAddress: HTTP_BIND_ADDRESS,
        port: parsePort(env[HTTP_ENV.port]),
        path: HTTP_PATH,
        token,
        allowedOrigins,
    };
}
export function allowedHostsFor(port) {
    return new Set([`${HTTP_BIND_ADDRESS}:${port}`, `localhost:${port}`]);
}
function constantTimeEquals(left, right) {
    const leftDigest = createHash('sha256').update(left, 'utf8').digest();
    const rightDigest = createHash('sha256').update(right, 'utf8').digest();
    return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}
function bearerToken(header) {
    if (header === undefined)
        return null;
    const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
    return match?.[1] ?? null;
}
function jsonRpcError(code, message) {
    return JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });
}
function reject(res, rejection, message, headers, onRejected) {
    onRejected?.(rejection);
    res.writeHead(rejection.status, { 'content-type': 'application/json', ...headers });
    res.end(jsonRpcError(-32000, message));
}
async function readBody(req, limit) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > limit)
            return 'too_large';
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}
export function createStreamableHttpRequestListener(options) {
    const { config, createMcpServer, onRejected, onError } = options;
    const modernHandler = createMcpHandler(() => createMcpServer(), {
        legacy: 'reject',
        ...(onError === undefined ? {} : { onerror: onError }),
    });
    const listener = async (req, res) => {
        const allowedHosts = options.allowedHosts;
        const url = new URL(req.url ?? '/', `http://${HTTP_BIND_ADDRESS}`);
        if (url.pathname !== config.path) {
            reject(res, { status: 404, reason: 'unknown_path' }, 'Not Found', {}, onRejected);
            req.resume();
            return;
        }
        const host = req.headers.host;
        if (host === undefined || !allowedHosts.has(host.toLowerCase())) {
            reject(res, { status: 403, reason: 'host_not_allowed' }, 'Forbidden: Host header is not this loopback listener', {}, onRejected);
            req.resume();
            return;
        }
        const origin = req.headers.origin;
        if (origin !== undefined && !config.allowedOrigins.has(origin.toLowerCase())) {
            reject(res, { status: 403, reason: 'origin_not_allowed' }, 'Forbidden: Origin is not allowed', {}, onRejected);
            req.resume();
            return;
        }
        const presented = bearerToken(req.headers.authorization);
        if (presented === null) {
            reject(res, { status: 401, reason: 'missing_bearer_token' }, 'Unauthorized: Bearer token required', { 'www-authenticate': `Bearer realm="${HTTP_REALM}"` }, onRejected);
            req.resume();
            return;
        }
        if (!constantTimeEquals(presented, config.token)) {
            reject(res, { status: 401, reason: 'invalid_bearer_token' }, 'Unauthorized: Bearer token rejected', { 'www-authenticate': `Bearer realm="${HTTP_REALM}", error="invalid_token"` }, onRejected);
            req.resume();
            return;
        }
        if (req.method !== 'POST') {
            reject(res, { status: 405, reason: 'method_not_allowed' }, 'Method Not Allowed: this stateless transport serves POST only (no GET stream, no DELETE session)', { allow: 'POST' }, onRejected);
            req.resume();
            return;
        }
        const contentType = req.headers['content-type'] ?? '';
        if (!/^application\/json\s*(;.*)?$/i.test(contentType)) {
            reject(res, { status: 415, reason: 'unsupported_media_type' }, 'Unsupported Media Type: application/json required', {}, onRejected);
            req.resume();
            return;
        }
        const declaredLength = Number(req.headers['content-length'] ?? '0');
        const body = declaredLength > HTTP_MAX_BODY_BYTES ? 'too_large' : await readBody(req, HTTP_MAX_BODY_BYTES);
        if (body === 'too_large') {
            reject(res, { status: 413, reason: 'body_too_large' }, `Payload Too Large: limit is ${HTTP_MAX_BODY_BYTES} bytes`, { connection: 'close' }, onRejected);
            req.resume();
            return;
        }
        let parsedBody;
        try {
            parsedBody = JSON.parse(body.toString('utf8'));
        }
        catch {
            onRejected?.({ status: 400, reason: 'invalid_json' });
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(jsonRpcError(-32700, 'Parse error: Invalid JSON'));
            return;
        }
        const aborted = new AbortController();
        res.once('close', () => { aborted.abort(); });
        const request = new Request(`http://${host}${req.url ?? config.path}`, {
            method: 'POST',
            headers: forwardedHeaders(req),
            body: new Uint8Array(body),
            signal: aborted.signal,
        });
        if (!await isLegacyRequest(request, parsedBody)) {
            await writeResponse(res, await modernHandler.fetch(request));
            return;
        }
        const mcpServer = createMcpServer();
        const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
        if (onError)
            transport.onerror = onError;
        res.once('close', () => {
            void mcpServer.close().catch(() => undefined);
        });
        await mcpServer.connect(transport);
        await writeResponse(res, await transport.handleRequest(request, { parsedBody }));
    };
    return Object.assign(listener, { close: () => modernHandler.close() });
}
const UNFORWARDED_HEADERS = new Set(['host', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'upgrade']);
function forwardedHeaders(req) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || UNFORWARDED_HEADERS.has(name))
            continue;
        for (const item of Array.isArray(value) ? value : [value])
            headers.append(name, item);
    }
    return headers;
}
async function writeResponse(res, response) {
    const headers = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    res.writeHead(response.status, headers);
    if (response.body === null) {
        res.end();
        return;
    }
    for await (const chunk of response.body) {
        if (res.destroyed)
            break;
        res.write(chunk);
    }
    res.end();
}
export async function startStreamableHttpServer(options) {
    const { config } = options;
    let boundPort = config.port;
    let allowedHosts = allowedHostsFor(boundPort);
    const listener = createStreamableHttpRequestListener({
        config,
        get allowedHosts() { return allowedHosts; },
        createMcpServer: options.createMcpServer,
        ...(options.onRejected === undefined ? {} : { onRejected: options.onRejected }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
    });
    const server = createNodeHttpServer((req, res) => {
        listener(req, res).catch((error) => {
            options.onError?.(error instanceof Error ? error : new Error(String(error)));
            if (!res.headersSent) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(jsonRpcError(-32603, 'Internal error'));
            }
            else {
                res.destroy();
            }
        });
    });
    server.keepAliveTimeout = 60_000;
    server.headersTimeout = 65_000;
    await new Promise((resolve, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(config.port, config.bindAddress, () => {
            server.off('error', rejectListen);
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === 'string' || address.address !== HTTP_BIND_ADDRESS) {
        server.close();
        throw new Error(`HTTP listener did not bind to ${HTTP_BIND_ADDRESS}.`);
    }
    boundPort = address.port;
    allowedHosts = allowedHostsFor(boundPort);
    return {
        port: boundPort,
        url: `http://${HTTP_BIND_ADDRESS}:${boundPort}${config.path}`,
        close: async () => {
            await new Promise((resolve, rejectClose) => {
                server.closeIdleConnections();
                server.close((error) => (error ? rejectClose(error) : resolve()));
            });
            await listener.close();
        },
    };
}
