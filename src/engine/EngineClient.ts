import type { EngineCommand, EngineEvent, EngineSnapshot, EngineTickTiming, PlayerInput, PlayerSpawn, Ruleset } from './protocol';

type SnapshotListener = (snapshot: EngineSnapshot) => void;
type NoticeListener = (message: string) => void;

export class EngineClient {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly noticeListeners = new Set<NoticeListener>();
  private timing?: EngineTickTiming;
  private readyResolver?: () => void;
  private readyRejecter?: (error: Error) => void;
  private readyPromise = new Promise<void>((resolve, reject) => {
    this.readyResolver = resolve;
    this.readyRejecter = reject;
  });

  constructor() {
    this.worker.addEventListener('message', (event: MessageEvent<EngineEvent>) => {
      this.handleEvent(event.data);
    });
  }

  init(ruleset: Ruleset, seed = 1): Promise<void> {
    this.timing = undefined;
    this.post({ type: 'init', ruleset, seed });
    return this.readyPromise;
  }

  tickTiming(): EngineTickTiming | undefined {
    return this.timing;
  }

  addPlayer(player: PlayerSpawn): void {
    this.post({ type: 'add-player', player });
  }

  removePlayer(playerId: string): void {
    this.post({ type: 'remove-player', playerId });
  }

  submitInput(playerId: string, input: PlayerInput): void {
    this.post({ type: 'input', playerId, input });
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'set-paused', paused });
  }

  resetObjectives(): void {
    this.post({ type: 'reset-objectives' });
  }

  clearTrace(): void {
    this.post({ type: 'clear-trace' });
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onNotice(listener: NoticeListener): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  destroy(): void {
    this.post({ type: 'stop' });
    this.worker.terminate();
  }

  private handleEvent(event: EngineEvent): void {
    if (event.type === 'timing') {
      this.timing = event.timing;
      return;
    }
    if (event.type === 'ready') {
      this.readyResolver?.();
      this.readyResolver = undefined;
      this.readyRejecter = undefined;
      return;
    }
    if (event.type === 'snapshot') {
      for (const listener of this.snapshotListeners) {
        listener(event.snapshot);
      }
      return;
    }
    if (event.type === 'error') {
      this.readyRejecter?.(new Error(event.message));
      this.readyRejecter = undefined;
    }
    if (event.type === 'notice' || event.type === 'error') {
      for (const listener of this.noticeListeners) {
        listener(event.message);
      }
    }
  }

  private post(command: EngineCommand): void {
    this.worker.postMessage(command);
  }
}
