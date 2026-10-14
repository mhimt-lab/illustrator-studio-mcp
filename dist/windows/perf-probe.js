import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const noop = () => { };
export function createWindowsDurationProbe(observer, now = () => performance.now()) {
    const records = [];
    let traceId;
    let flushed = false;
    const clock = () => {
        try {
            const value = now();
            return Number.isFinite(value) && value >= 0 ? value : undefined;
        }
        catch {
            return undefined;
        }
    };
    return {
        start(phase) {
            if (observer === undefined || flushed)
                return noop;
            const started = clock();
            let finished = false;
            return () => {
                if (finished || flushed)
                    return;
                finished = true;
                const ended = clock();
                if (started === undefined || ended === undefined || ended < started || records.length >= 8)
                    return;
                try {
                    traceId ??= randomUUID();
                    records.push(Object.freeze({ phase, elapsedMs: ended - started, count: 1, traceId }));
                }
                catch { }
            };
        },
        flush() {
            if (flushed)
                return;
            flushed = true;
            if (observer === undefined || records.length === 0)
                return;
            try {
                setImmediate(() => {
                    for (const record of records) {
                        try {
                            void Promise.resolve(observer(record)).catch(noop);
                        }
                        catch { }
                    }
                });
            }
            catch { }
        },
    };
}
export function measureWindowsDuration(phase, work, observer) {
    if (observer === undefined)
        return work();
    const probe = createWindowsDurationProbe(observer);
    const finish = probe.start(phase);
    return (async () => {
        try {
            return await work();
        }
        finally {
            finish();
            probe.flush();
        }
    })();
}
