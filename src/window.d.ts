import type { EngineSnapshot } from './engine/protocol';

declare global {
  interface Window {
    __BEAT_SNAPSHOT__?: EngineSnapshot;
  }
}

export {};

