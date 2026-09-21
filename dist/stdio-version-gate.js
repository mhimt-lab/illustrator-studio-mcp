import { PROTOCOL_VERSION_META_KEY, UnsupportedProtocolVersionError, } from '@modelcontextprotocol/server';
export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'];
function requestedVersion(message) {
    if (!('method' in message) || !('id' in message))
        return undefined;
    const meta = message.params?._meta;
    const version = meta?.[PROTOCOL_VERSION_META_KEY];
    return typeof version === 'string' ? version : undefined;
}
export class StdioProtocolVersionGate {
    inner;
    supportedVersions;
    state = { era: 'opening' };
    onclose;
    onerror;
    onmessage;
    constructor(inner, supportedVersions = MODERN_PROTOCOL_VERSIONS) {
        this.inner = inner;
        this.supportedVersions = supportedVersions;
        inner.onclose = () => this.onclose?.();
        inner.onerror = (error) => this.onerror?.(error);
        inner.onmessage = (message, extra) => this.receive(message, extra);
    }
    get sessionId() { return this.inner.sessionId; }
    setProtocolVersion(version) { this.inner.setProtocolVersion?.(version); }
    start() { return this.inner.start(); }
    send(message, options) { return this.inner.send(message, options); }
    close() { return this.inner.close(); }
    receive(message, extra) {
        const version = requestedVersion(message);
        if (this.state.era === 'opening' && 'method' in message && 'id' in message) {
            if (version === undefined)
                this.state = { era: 'legacy' };
            else if (this.supportedVersions.includes(version) && message.method !== 'server/discover')
                this.state = { era: 'modern', version };
        }
        else if (this.state.era === 'modern' && version !== undefined && version !== this.state.version) {
            const error = new UnsupportedProtocolVersionError({ supported: [...this.supportedVersions], requested: version });
            this.inner.send({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: error.code, message: error.message, data: error.data },
            }).catch((sendError) => this.onerror?.(sendError instanceof Error ? sendError : new Error(String(sendError))));
            return;
        }
        this.onmessage?.(message, extra);
    }
}
