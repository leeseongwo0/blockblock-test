type Entry = {
  count: number;
  resetAt: number;
};

export type LimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export class FixedWindowLimiter {
  private readonly store = new Map<string, Entry>();
  private calls = 0;

  consume(key: string, max: number, windowMs: number): LimitResult {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now >= existing.resetAt) {
      this.store.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      this.maybeCleanup(now);
      return {
        allowed: true,
        remaining: Math.max(0, max - 1),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    if (existing.count >= max) {
      this.maybeCleanup(now);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    this.store.set(key, existing);
    this.maybeCleanup(now);
    return {
      allowed: true,
      remaining: Math.max(0, max - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  private maybeCleanup(now: number) {
    this.calls += 1;
    if (this.calls % 200 !== 0 && this.store.size < 5000) {
      return;
    }

    for (const [key, value] of this.store.entries()) {
      if (now >= value.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

