export type WakeLockView = { active: boolean; pending: boolean; supported: boolean; message: string };

/** Owns screen wake intent, one pending request, and the acquired sentinel. */
export class WakeLockSession {
  private sentinel?: WakeLockSentinel;
  private desired = false;
  private pending = false;
  private destroyed = false;
  private generation = 0;
  private readonly events = new AbortController();

  constructor(private readonly publish: (view: WakeLockView) => void) {
    document.addEventListener('visibilitychange', () => this.visibilityChanged(), { signal: this.events.signal });
    this.render('Screen wake lock is off.');
  }

  async toggle(): Promise<void> {
    if (this.destroyed) return;
    this.desired = !this.desired;
    this.generation++;
    if (this.desired) await this.acquire();
    else this.release();
  }

  destroy(): void {
    this.destroyed = true;
    this.desired = false;
    this.generation++;
    this.events.abort();
    this.release();
  }

  private visibilityChanged(): void {
    if (document.visibilityState !== 'visible') {
      this.generation++;
      this.release();
      return;
    }
    if (this.desired) void this.acquire();
  }

  private async acquire(): Promise<void> {
    if (!this.canAcquire()) return;
    if (!navigator.wakeLock) return;
    const generation = this.generation;
    this.pending = true;
    this.render('Requesting screen wake lock…');
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.isCurrentRequest(generation)) {
        await sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => this.systemReleased(sentinel), { once: true });
      this.render('Screen stays awake while Beat is visible.');
    } catch (error) {
      if (generation !== this.generation) return;
      this.desired = false;
      this.render(`Screen wake lock unavailable: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pending = false;
      this.render();
      if (!this.destroyed && this.desired && generation !== this.generation) void this.acquire();
    }
  }

  private canAcquire(): boolean {
    return !this.destroyed && this.desired && !this.pending && !this.sentinel && document.visibilityState === 'visible';
  }

  private isCurrentRequest(generation: number): boolean {
    return !this.destroyed && this.desired && generation === this.generation && document.visibilityState === 'visible';
  }

  private systemReleased(sentinel: WakeLockSentinel): void {
    if (this.sentinel !== sentinel) return;
    this.sentinel = undefined;
    if (document.visibilityState === 'visible') this.desired = false;
    this.render('The browser released the wake lock.');
  }

  private release(): void {
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    void sentinel?.release().catch(() => undefined);
    this.render(this.desired ? 'Wake lock paused while hidden; it restores on return.' : 'Screen wake lock is off.');
  }

  private message = '';
  private render(message = this.message): void {
    if (this.destroyed) return;
    this.message = message;
    this.publish({ active: Boolean(this.sentinel), pending: this.pending, supported: Boolean(navigator.wakeLock), message });
  }
}
