/**
 * Input capability detection and last-active modality tracking.
 *
 * This module feeds the profile-driven control system with two pieces of local
 * context:
 * - a coarse capability bucket used to choose defaults per device class, and
 * - the last-active modality used to adjust affordances without discarding the
 *   user's chosen profile.
 *
 * It is consumed by the current preferences / profile-resolution flow rather
 * than being future scaffolding.
 */

export type PrimaryPointer = 'fine' | 'coarse' | 'none';
export type Modality = 'keyboard' | 'mouse' | 'touch' | 'pen';
export type CapabilityBucket = 'fine-only' | 'coarse-only' | 'hybrid' | 'none';

export type InputCapabilities = {
  primaryPointer: PrimaryPointer;
  anyFinePointer: boolean;
  anyCoarsePointer: boolean;
  maxTouchPoints: number;
  bucket: CapabilityBucket;
};

type MatchMediaLike = (query: string) => { matches: boolean };

type DetectOptions = {
  matchMedia?: MatchMediaLike;
  maxTouchPoints?: number;
};

export function detectCapabilities(options: DetectOptions = {}): InputCapabilities {
  const mm: MatchMediaLike =
    options.matchMedia ??
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? (query: string) => window.matchMedia(query)
      : () => ({ matches: false }));

  const maxTouchPoints =
    options.maxTouchPoints ??
    (typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints
      : 0);

  const primaryPointer: PrimaryPointer = mm('(pointer: fine)').matches
    ? 'fine'
    : mm('(pointer: coarse)').matches
      ? 'coarse'
      : 'none';

  const anyFinePointer = mm('(any-pointer: fine)').matches;
  const anyCoarsePointer = mm('(any-pointer: coarse)').matches || maxTouchPoints > 0;

  const bucket: CapabilityBucket =
    anyFinePointer && anyCoarsePointer
      ? 'hybrid'
      : anyFinePointer
        ? 'fine-only'
        : anyCoarsePointer
          ? 'coarse-only'
          : 'none';

  return {
    primaryPointer,
    anyFinePointer,
    anyCoarsePointer,
    maxTouchPoints,
    bucket,
  };
}

/**
 * Tracks the most recently used input modality. Listeners are notified only
 * when the modality actually changes, so they can be safely connected to UI
 * fade-in / fade-out logic.
 */
export class ModalityTracker {
  private modality: Modality;
  private readonly listeners = new Set<(modality: Modality) => void>();

  constructor(initial: Modality = 'mouse') {
    this.modality = initial;
  }

  get current(): Modality {
    return this.modality;
  }

  onChange(listener: (modality: Modality) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notePointerEvent(event: Pick<PointerEvent, 'pointerType'>): void {
    switch (event.pointerType) {
      case 'touch':
        this.set('touch');
        break;
      case 'pen':
        this.set('pen');
        break;
      case 'mouse':
      default:
        this.set('mouse');
        break;
    }
  }

  noteKeyboardEvent(): void {
    this.set('keyboard');
  }

  private set(next: Modality): void {
    if (next === this.modality) return;
    this.modality = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
