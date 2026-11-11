import { WakeLockSession, type WakeLockView } from './pwa/wakeLock';

interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function workerRequest(worker: ServiceWorker, type: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (result: string) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish('Update cancelled.');
    const timeout = window.setTimeout(() => finish('Update check timed out. Please try again.'), 5_000);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || !('kind' in data)) return;
      if (data.kind === 'ready') finish('ready');
      else finish('reason' in data && typeof data.reason === 'string' ? data.reason : 'Offline cache is unavailable.');
    };
    try { worker.postMessage({ type }, [channel.port2]); }
    catch { finish('Could not contact the app worker. Please try again.'); }
  });
}

export function deviceSessionHtml(): string {
  return `<section class="device-session" aria-labelledby="device-heading">
    <h2 id="device-heading">App &amp; device</h2>
    <p id="device-context" class="room-summary"></p>
    <div class="button-grid">
      <button id="pwa-install" class="button" type="button">Install via browser</button>
      <button class="button" type="button" data-wake-lock aria-pressed="false">Keep screen awake</button>
      <button id="pwa-update" class="button button--primary" type="button" hidden>Apply update</button>
    </div>
    <p id="pwa-status" class="room-summary" role="status"></p>
    <p id="wake-lock-status" class="room-summary" role="status"></p>
  </section>`;
}

/** One owner for install prompts, worker updates, device status and disposal. */
export class PwaSession {
  private readonly events = new AbortController();
  private readonly status: HTMLElement;
  private readonly install: HTMLButtonElement;
  private readonly update: HTMLButtonElement;
  private readonly wake: WakeLockSession;
  private prompt?: InstallPrompt;
  private registration?: ServiceWorkerRegistration;
  private watchedWorker?: ServiceWorker;
  private destroyed = false;
  private applying = false;
  private reloadTimer?: number;
  private checkTimer?: number;

  get applyingUpdate(): boolean { return this.applying; }

  constructor(private readonly root: HTMLElement, private readonly updateBlocker: () => string | undefined) {
    this.status = root.querySelector<HTMLElement>('#pwa-status')!;
    this.install = root.querySelector<HTMLButtonElement>('#pwa-install')!;
    this.update = root.querySelector<HTMLButtonElement>('#pwa-update')!;
    this.wake = new WakeLockSession((view) => this.renderWake(view));
    const options = { signal: this.events.signal };
    this.install.addEventListener('click', () => void this.installApp(), options);
    this.update.addEventListener('click', () => void this.applyUpdate(), options);
    root.querySelectorAll<HTMLButtonElement>('[data-wake-lock]').forEach((button) => {
      button.addEventListener('click', () => void this.wake.toggle(), options);
    });
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.prompt = event as InstallPrompt;
      this.renderContext();
    }, options);
    window.addEventListener('appinstalled', () => {
      this.prompt = undefined;
      this.status.textContent = 'Installation completed. Launch Beat from your home screen.';
      this.renderContext();
    }, options);
    const query = window.matchMedia('(display-mode: standalone)');
    query.addEventListener('change', () => this.renderContext(), options);
    window.addEventListener('online', () => { this.renderContext(); void this.checkUpdate(); }, options);
    window.addEventListener('offline', () => this.renderContext(), options);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.checkUpdate();
    }, options);
    this.renderContext();
  }

  start(): void {
    if (!import.meta.env.PROD) {
      this.status.textContent = 'Offline installation is available in the production build. Use preview:https for phone testing.';
      return;
    }
    if (!('serviceWorker' in navigator)) {
      this.status.textContent = 'Offline support requires a supported browser and HTTPS trusted by this device.';
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => this.controllerChanged(), { signal: this.events.signal });
    void this.register();
  }

  destroy(): void {
    this.destroyed = true;
    this.events.abort();
    this.wake.destroy();
    window.clearTimeout(this.reloadTimer);
    window.clearInterval(this.checkTimer);
    this.root.inert = false;
  }

  private renderContext(): void {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    this.install.disabled = standalone;
    this.install.textContent = standalone ? 'App window' : this.prompt ? 'Install app' : 'Install via browser';
    this.root.querySelector('#device-context')!.textContent = `${standalone ? 'App window' : 'Browser tab'} · ${navigator.onLine ? 'Network available' : 'Offline: rooms need a connection'}`;
  }

  private renderWake(view: WakeLockView): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-wake-lock]').forEach((button) => {
      button.disabled = !view.supported || view.pending;
      const label = view.active ? 'Allow screen sleep' : 'Keep screen awake';
      button.textContent = button.hasAttribute('data-wake-lock-compact') ? '☀' : label;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.setAttribute('aria-pressed', String(view.active));
    });
    this.root.querySelector('#wake-lock-status')!.textContent = view.supported ? view.message :
      'Screen wake lock is unavailable. Use a supported browser over trusted HTTPS.';
  }

  private async installApp(): Promise<void> {
    const prompt = this.prompt;
    if (!prompt) {
      this.status.textContent = /iPad|iPhone|iPod/.test(navigator.userAgent)
        ? 'In Safari, open Share, then Add to Home Screen.'
        : 'Use your browser’s Install app or Add to Home Screen menu.';
      return;
    }
    this.prompt = undefined;
    this.install.disabled = true;
    try {
      const choice = await prompt.prompt();
      if (this.destroyed) return;
      this.status.textContent = choice.outcome === 'accepted' ? 'Install accepted; your browser is completing installation.' : 'Installation dismissed. You can still install from the browser menu.';
    } catch {
      if (!this.destroyed) this.status.textContent = 'Installation could not start. Use the browser install menu.';
    } finally {
      if (!this.destroyed) this.renderContext();
    }
  }

  private async register(): Promise<void> {
    this.status.textContent = 'Preparing offline practice and replays…';
    try {
      const base = new URL(import.meta.env.BASE_URL, window.location.href);
      const registration = await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname, updateViaCache: 'none' });
      if (this.destroyed) return;
      this.registration = registration;
      registration.addEventListener('updatefound', () => this.watchInstalling(), { signal: this.events.signal });
      this.watchInstalling();
      if (registration.waiting) this.updateReady();
      else if (registration.active) await this.reportOfflineReady(registration.active);
      if (this.destroyed) return;
      this.checkTimer = window.setInterval(() => { if (!document.hidden) void this.checkUpdate(); }, 60_000);
    } catch (error) {
      if (!this.destroyed) this.status.textContent = `Offline setup failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private watchInstalling(): void {
    const worker = this.registration?.installing;
    if (!worker || this.watchedWorker === worker) return;
    this.watchedWorker = worker;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && this.registration?.active) this.updateReady();
      if (worker.state === 'redundant') this.status.textContent = 'The app download failed. Current play is unchanged; retry when connected.';
    }, { signal: this.events.signal });
  }

  private updateReady(): void {
    this.update.hidden = false;
    this.status.textContent = 'Update available. Apply from the menu after leaving your room and closing other Beat tabs.';
  }

  private async reportOfflineReady(worker: ServiceWorker): Promise<void> {
    const result = await workerRequest(worker, 'BEAT_SHELL_STATUS', this.events.signal);
    if (this.destroyed || this.registration?.waiting) return;
    this.status.textContent = result === 'ready' ? 'Offline practice, workbench and replay files are ready. Rooms still need a network.' : result;
  }

  private controllerChanged(): void {
    if (this.applying) { window.location.reload(); return; }
    const worker = navigator.serviceWorker.controller;
    if (worker) void this.reportOfflineReady(worker);
  }

  private async checkUpdate(): Promise<void> {
    try { await this.registration?.update(); }
    catch { if (!this.destroyed && navigator.onLine) this.status.textContent = 'Could not check for updates. Current play is unchanged.'; }
  }

  private async applyUpdate(): Promise<void> {
    if (!this.registration?.waiting || this.applying) return;
    const blocker = this.updateBlocker();
    if (blocker) { this.status.textContent = blocker; return; }
    if (!window.confirm('Updating reloads Beat. Export any replay and copy custom rules you want to keep. Apply update?')) return;
    if (this.destroyed || this.applying) return;
    const nextBlocker = this.updateBlocker();
    if (nextBlocker) { this.status.textContent = nextBlocker; return; }
    const worker = this.registration?.waiting;
    if (!worker) { this.status.textContent = 'Update is already active or no longer waiting.'; return; }
    this.applying = true;
    this.root.inert = true;
    this.status.textContent = 'Applying update…';
    const result = await workerRequest(worker, 'BEAT_APPLY_UPDATE', this.events.signal);
    if (this.destroyed) return;
    if (result !== 'ready') { this.updateFailed(result); return; }
    this.reloadTimer = window.setTimeout(() => this.updateFailed('Update activation timed out. Try again when connected.'), 10_000);
  }

  private updateFailed(message: string): void {
    this.applying = false;
    this.root.inert = false;
    this.status.textContent = message;
  }
}
