import type { AiTraceSnapshot, EngineSnapshot, MechanicTraceSnapshot } from './engine/protocol';
import type { NetDiagnostics } from './net/webrtc';

declare global {
  interface Window {
    __BEAT_SNAPSHOT__?: EngineSnapshot;
    __BEAT_RENDER_SNAPSHOT__?: EngineSnapshot;
    __BEAT_NET_STATS__?: (NetDiagnostics & {
      predictionErrorEwma?: number;
      predictionErrorMax?: number;
      remoteExtrapolationSeconds?: number;
      remoteExtrapolationEvents?: number;
    });
    __BEAT_TRACE__?: MechanicTraceSnapshot[];
    __BEAT_AI_TRACE__?: AiTraceSnapshot[];
  }
}

export {};
