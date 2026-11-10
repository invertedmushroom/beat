import type { EngineSnapshot } from '../engine/protocol';
import { SnapshotDecoder } from '../net/snapshotCodec';
import type { ReplayClip, ReplayDiagnostics } from './archive';

export type ReplayView = { snapshot: EngineSnapshot; positionMs: number; durationMs: number; playing: boolean; speed: number; diagnostics?: ReplayDiagnostics };

/** Visual playback only: checkpoints restore the decoder, never the live engine. */
export class ReplayPlayer {
  private positionMs = 0;
  private playing = false;
  private speed = 1;
  private lastNow?: number;
  private decoder: SnapshotDecoder;
  private decodedIndex = -1;
  private readonly recent = new Map<number, EngineSnapshot>();
  private readonly checkpoints: number[];

  constructor(readonly clip: ReplayClip) {
    this.decoder = new SnapshotDecoder(clip.metadata.ruleset.arena);
    this.checkpoints = clip.frames.flatMap((frame, index) => frame.keyframe ? [index] : []);
  }

  seek(positionMs: number): void {
    if (!Number.isFinite(positionMs)) return;
    this.positionMs = Math.max(0, Math.min(this.clip.durationMs, positionMs));
    this.lastNow = undefined;
  }
  setPlaying(playing: boolean): void {
    if (playing && this.positionMs >= this.clip.durationMs) this.seek(0);
    this.playing = playing;
    this.lastNow = undefined;
  }
  setSpeed(speed: number): void {
    if (![0.5, 1, 2].includes(speed)) return;
    this.speed = speed;
    this.lastNow = undefined;
  }

  frame(nowMs: number): ReplayView {
    if (this.playing && this.lastNow !== undefined) this.positionMs = Math.min(this.clip.durationMs, this.positionMs + Math.max(0, nowMs - this.lastNow) * this.speed);
    this.lastNow = nowMs;
    if (this.positionMs >= this.clip.durationMs) this.playing = false;
    const targetTick = this.clip.frames[0].tick + this.positionMs / 1000 * this.clip.metadata.ruleset.tickRate;
    const index = lowerFrame(this.clip.frames, targetTick);
    const nextIndex = Math.min(index + 1, this.clip.frames.length - 1);
    if (!this.recent.has(index) && (index <= this.decodedIndex || index - this.decodedIndex > 60)) {
      let checkpoint = 0;
      for (const candidate of this.checkpoints) { if (candidate > index) break; checkpoint = candidate; }
      this.decoder = new SnapshotDecoder(this.clip.metadata.ruleset.arena);
      this.decodedIndex = checkpoint - 1;
      this.recent.clear();
    }
    while (this.decodedIndex < nextIndex) {
      const record = this.clip.frames[++this.decodedIndex];
      let decoded: EngineSnapshot | undefined;
      for (const packet of record.packets) decoded = this.decoder.receive(packet.buffer as ArrayBuffer, 0).snapshot ?? decoded;
      if (!decoded) throw new Error('Replay baseline chain is incomplete');
      this.recent.set(this.decodedIndex, decoded);
      while (this.recent.size > 2) this.recent.delete(this.recent.keys().next().value!);
    }
    const before = this.recent.get(index)!, after = this.recent.get(nextIndex)!;
    const alpha = after.tick === before.tick ? 0 : Math.max(0, Math.min(1, (targetTick - before.tick) / (after.tick - before.tick)));
    return { snapshot: interpolate(before, after, alpha), positionMs: this.positionMs, durationMs: this.clip.durationMs,
      playing: this.playing, speed: this.speed, diagnostics: this.clip.frames[index].diagnostics };
  }
}

function lowerFrame(frames: ReplayClip['frames'], tick: number): number {
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].tick <= tick) low = middle;
    else high = middle - 1;
  }
  return low;
}
function interpolate(before: EngineSnapshot, after: EngineSnapshot, alpha: number): EngineSnapshot {
  const players = new Map(after.players.map((player) => [player.playerId, player]));
  const projectiles = new Map(after.projectiles.map((projectile) => [projectile.projectileId, projectile]));
  const bodies = new Map(after.physicsBodies.map((body) => [body.bodyId, body]));
  const position = <T extends { x: number; y: number }>(a: T, b: T | undefined): T => b ? { ...a, x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha } : { ...a };
  return { ...before,
    players: before.players.map((player) => {
      const next = players.get(player.playerId);
      return position(player, next?.alive === player.alive && next?.respawnTick === player.respawnTick ? next : undefined);
    }),
    projectiles: before.projectiles.map((projectile) => position(projectile, projectiles.get(projectile.projectileId))),
    physicsBodies: before.physicsBodies.map((body) => position(body, bodies.get(body.bodyId))),
  };
}
