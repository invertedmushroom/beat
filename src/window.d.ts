import type { AiTraceSnapshot, EngineSnapshot, MechanicTraceSnapshot } from './engine/protocol';

declare global {
  interface Window {
    __BEAT_SNAPSHOT__?: EngineSnapshot;
    __BEAT_TRACE__?: MechanicTraceSnapshot[];
    __BEAT_AI_TRACE__?: AiTraceSnapshot[];
  }
}

export {};
