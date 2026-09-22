export const CALL_TIMING_ENV = 'ILLUSTRATOR_STUDIO_MCP_CALL_TIMING';
export function callTimingEnabled(env = process.env) {
    return env[CALL_TIMING_ENV] === '1';
}
const TOOL_NAME = /^illustrator_[a-z0-9_]{1,64}$/u;
export class CallTimingTransport {
    inner;
    write;
    now;
    pending = new Map();
    onclose;
    onerror;
    onmessage;
    constructor(inner, write = (record) => {
        process.stderr.write(`illustrator-studio-mcp: call-timing ${JSON.stringify(record)}\n`);
    }, now = () => performance.now()) {
        this.inner = inner;
        this.write = write;
        this.now = now;
        inner.onclose = () => { this.pending.clear(); this.onclose?.(); };
        inner.onerror = (error) => this.onerror?.(error);
        inner.onmessage = (message, extra) => {
            if ('method' in message && message.method === 'tools/call' && 'id' in message) {
                const name = message.params?.name;
                this.pending.set(message.id, { tool: typeof name === 'string' && TOOL_NAME.test(name) ? name : 'other',
                    receivedAt: new Date(), started: this.now() });
            }
            this.onmessage?.(message, extra);
        };
    }
    get sessionId() { return this.inner.sessionId; }
    setProtocolVersion(version) { this.inner.setProtocolVersion?.(version); }
    start() { return this.inner.start(); }
    async send(message, options) {
        await this.inner.send(message, options);
        if (!('id' in message) || 'method' in message || message.id === undefined)
            return;
        const started = this.pending.get(message.id);
        if (started === undefined)
            return;
        this.pending.delete(message.id);
        try {
            this.write({ tool: started.tool, receivedAt: started.receivedAt.toISOString(),
                ms: Math.round((this.now() - started.started) * 10) / 10, outcome: 'error' in message ? 'error' : 'result' });
        }
        catch {
        }
    }
    close() { return this.inner.close(); }
}
