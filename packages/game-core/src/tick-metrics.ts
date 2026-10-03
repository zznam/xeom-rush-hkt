// Fixed memory and 0.1ms buckets keep long soak measurements bounded.
export class TickMetrics {
  private buckets = new Uint32Array(1001);
  private count = 0;
  private total = 0;
  private maximum = 0;
  record(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.count++;
    this.total += ms;
    this.maximum = Math.max(this.maximum, ms);
    this.buckets[Math.min(1000, Math.ceil(ms * 10))]++;
  }
  snapshot() {
    const rank = Math.ceil(this.count * 0.95);
    let seen = 0,
      p95 = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      seen += this.buckets[i];
      if (seen >= rank) {
        p95 = i === 1000 ? this.maximum : i / 10;
        break;
      }
    }
    return { ticks: this.count, meanMs: this.count ? this.total / this.count : 0, p95Ms: p95, maxMs: this.maximum };
  }
}
