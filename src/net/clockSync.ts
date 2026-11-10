import type { EngineTickTiming } from '../engine/protocol';

export const INPUT_ARRIVAL_LEAD_MS = 20;
const MAX_SAMPLE_GAP_MS = 15_000;

type Sample = { client: number; server: number; rtt: number };

/** NTP midpoint samples fitted around a recent origin to avoid epoch precision loss. */
export class AffineClockSync {
  private samples: Sample[] = [];
  private origin?: Sample;
  private rate = 1;
  private offset = 0;
  private timing?: EngineTickTiming;
  private lastReceivedAt = -Infinity;

  reset(): void {
    this.samples = [];
    this.origin = undefined;
    this.rate = 1;
    this.offset = 0;
    this.timing = undefined;
    this.lastReceivedAt = -Infinity;
  }

  observe(t1: number, t2: number, t3: number, t4: number, timing?: EngineTickTiming): boolean {
    if (![t1, t2, t3, t4].every(Number.isFinite) || t4 < t1 || t3 < t2) return false;
    const rtt = t4 - t1 - (t3 - t2);
    if (rtt < 0 || rtt > 2_000) return false;
    if (t4 - this.lastReceivedAt > MAX_SAMPLE_GAP_MS) this.reset();
    this.lastReceivedAt = t4;
    this.samples.push({ client: (t1 + t4) / 2, server: (t2 + t3) / 2, rtt });
    this.samples = this.samples.filter((sample) => t4 - sample.client < 60_000).slice(-64);
    const minRtt = Math.min(...this.samples.map((sample) => sample.rtt));
    const good = this.samples.filter((sample) => sample.rtt <= minRtt + 5);
    const clientMean = good.reduce((sum, sample) => sum + sample.client, 0) / good.length;
    // Subtract an origin before summing server timestamps (worker clock uses timeOrigin).
    const serverOrigin = good[0].server;
    const serverMean = serverOrigin + good.reduce((sum, sample) => sum + sample.server - serverOrigin, 0) / good.length;
    let variance = 0;
    let covariance = 0;
    for (const sample of good) {
      variance += (sample.client - clientMean) ** 2;
      covariance += (sample.client - clientMean) * (sample.server - serverMean);
    }
    this.rate = good.length >= 4 && good.at(-1)!.client - good[0].client >= 3_000 && variance > 0
      ? Math.max(0.999, Math.min(1.001, covariance / variance)) : 1;
    this.origin = { client: clientMean, server: serverMean, rtt: minRtt };
    this.offset = serverMean - this.rate * clientMean;
    if (timing) this.updateTiming(timing);
    return true;
  }

  updateTiming(timing: EngineTickTiming): boolean {
    if (this.timing && (timing.tick < this.timing.tick || timing.nextTickAtMs < this.timing.nextTickAtMs)) return false;
    this.timing = timing;
    return true;
  }

  toServer(clientMs: number): number {
    return this.origin ? this.origin.server + this.rate * (clientMs - this.origin.client) : clientMs;
  }

  /** Send at the first phase whose estimated arrival precedes a worker tick by 20ms. */
  inputDelayMs(nowMs: number): number {
    if (!this.origin || !this.timing || nowMs - this.lastReceivedAt > 5_000) return 0;
    const { nextTickAtMs, intervalMs } = this.timing;
    const oneWay = this.origin.rtt * this.rate / 2;
    const earliestArrival = this.toServer(nowMs) + oneWay + INPUT_ARRIVAL_LEAD_MS;
    const periods = Math.max(0, Math.ceil((earliestArrival - nextTickAtMs) / intervalMs));
    const sendAt = nextTickAtMs + periods * intervalMs - oneWay - INPUT_ARRIVAL_LEAD_MS;
    return Math.max(0, Math.min(intervalMs / this.rate, (sendAt - this.toServer(nowMs)) / this.rate));
  }

  stats(): { rate: number; offsetMs: number; rttMs?: number; samples: number } {
    return { rate: this.rate, offsetMs: this.offset, rttMs: this.origin?.rtt, samples: this.samples.length };
  }
}
