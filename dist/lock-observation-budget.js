import { setTimeout as delay } from 'node:timers/promises';
export class LockObservationBudgetExhaustedError extends Error {
    constructor() {
        super('The shared lock observation budget is exhausted.');
        this.name = 'LockObservationBudgetExhaustedError';
    }
}
export class LockObservationBudget {
    initial = new Set();
    waitMs;
    now;
    sleep;
    onAttempt;
    deadline = null;
    retries = 0;
    constructor(waitMs = 250, hooks = {}) {
        if (!Number.isFinite(waitMs) || waitMs < 0)
            throw new Error('Lock observation wait must be a finite non-negative number.');
        this.waitMs = Math.min(250, waitMs);
        this.now = hooks.now ?? (() => performance.now());
        this.sleep = hooks.sleep ?? delay;
        this.onAttempt = hooks.onAttempt;
    }
    startWaiting() {
        this.deadline ??= this.now() + this.waitMs;
    }
    async enter(phase) {
        if (!this.initial.has(phase)) {
            this.initial.add(phase);
            this.onAttempt?.({ phase, kind: 'initial', allowed: true, retries: this.retries, deadline: this.deadline });
            return;
        }
        if (!await this.retry(phase))
            throw new LockObservationBudgetExhaustedError();
    }
    async retry(phase) {
        this.startWaiting();
        const remaining = this.deadline - this.now();
        let allowed = remaining > 0 && this.retries < 25;
        if (allowed) {
            this.retries += 1;
            await this.sleep(Math.min(10, remaining));
            allowed = this.now() < this.deadline;
        }
        this.onAttempt?.({ phase, kind: 'retry', allowed, retries: this.retries, deadline: this.deadline });
        return allowed;
    }
}
