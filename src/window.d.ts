import type { EngineSnapshot, MechanicTraceSnapshot } from './engine/protocol';

declare global {
  interface Window {
    __BEAT_SNAPSHOT__?: EngineSnapshot;
    __BEAT_TRACE__?: MechanicTraceSnapshot[];
  }
}

export {};
