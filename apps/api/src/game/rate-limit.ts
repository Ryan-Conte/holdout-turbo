// Per-socket token buckets — first line of anti-cheat (see docs/ANTICHEAT.md).

interface Bucket {
  tokens: number;
  last: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly perSecond: number,
    private readonly burst = perSecond * 2,
  ) {}

  /** Returns true when the action is allowed. */
  allow(key: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, last: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.last) / 1000) * this.perSecond);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  clear(key: string) {
    this.buckets.delete(key);
  }
}
