import type { EngineSnapshot } from '../engine/protocol';
import { SnapshotDecoder } from '../net/snapshotCodec';
import type { ReplayClip, ReplayDiagnostics } from './archive';

export type PredictionGhost = { playerId: string; x: number; y: number };
export type ReplayView = { snapshot: EngineSnapshot; positionMs: number; durationMs: number; playing: boolean; speed: number; diagnostics?: ReplayDiagnostics; predictionGhost?: PredictionGhost };

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
  step(direction: -1 | 1): void {
    const index = lowerFrame(this.clip, this.positionMs);
    const destination = direction > 0 ? Math.min(index + 1, this.clip.frames.length - 1)
      : this.positionMs > frameTimeMs(this.clip, index) ? index : Math.max(0, index - 1);
    this.setPlaying(false);
    this.seek(frameTimeMs(this.clip, destination));
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
    const index = lowerFrame(this.clip, this.positionMs);
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
    const predictionGhost = this.ghost(before, after, index, nextIndex, alpha);
    return { snapshot: interpolate(before, after, alpha), positionMs: this.positionMs, durationMs: this.clip.durationMs,
      playing: this.playing, speed: this.speed, diagnostics: this.clip.frames[index].diagnostics, predictionGhost };
  }

  private ghost(before: EngineSnapshot, after: EngineSnapshot, index: number, nextIndex: number, alpha: number): PredictionGhost | undefined {
    const playerId = this.clip.metadata.localPlayerId;
    const player = before.players.find((entry) => entry.playerId === playerId);
    const predicted = this.clip.frames[index].diagnostics?.predictedPosition;
    if (!playerId || !player?.alive || !predicted) return undefined;
    if (alpha === 0) return { playerId, ...predicted };
    const nextPlayer = after.players.find((entry) => entry.playerId === playerId);
    const next = this.clip.frames[nextIndex].diagnostics?.predictedPosition;
    if (!next || !nextPlayer?.alive || nextPlayer.respawnTick !== player.respawnTick) return undefined;
    return { playerId, x: predicted.x + (next.x - predicted.x) * alpha, y: predicted.y + (next.y - predicted.y) * alpha };
  }
}

function frameTimeMs(clip: ReplayClip, index: number): number {
  return (clip.frames[index].tick - clip.frames[0].tick) / clip.metadata.ruleset.tickRate * 1000;
}
function lowerFrame(clip: ReplayClip, positionMs: number): number {
  let low = 0, high = clip.frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frameTimeMs(clip, middle) <= positionMs) low = middle;
    else high = middle - 1;
  }
  return low;
}
function interpolate(before: EngineSnapshot, after: EngineSnapshot, alpha: number): EngineSnapshot {
  if (alpha === 0) return before;
  const players = new Map(after.players.map((player) => [player.playerId, player]));
  const projectiles = new Map(after.projectiles.map((projectile) => [projectile.projectileId, projectile]));
  const bodies = new Map(after.physicsBodies.map((body) => [body.bodyId, body]));
  const objectives = new Map(after.objectives.map((objective) => [objective.objectiveId, objective]));
  const position = <T extends { x: number; y: number }>(a: T, b: T | undefined): T => b ? { ...a, x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha } : { ...a };
  return { ...before,
    players: before.players.map((player) => {
      const next = players.get(player.playerId);
      if (!next || next.alive !== player.alive || next.respawnTick !== player.respawnTick) return player;
      const facing = direction(player.facingDx, player.facingDy, next.facingDx, next.facingDy, alpha);
      const aim = direction(player.aimDx, player.aimDy, next.aimDx, next.aimDy, alpha);
      return { ...position(player, next), facingDx: facing.x, facingDy: facing.y, aimDx: aim.x, aimDy: aim.y };
    }),
    projectiles: before.projectiles.map((projectile) => position(projectile, projectiles.get(projectile.projectileId))),
    physicsBodies: before.physicsBodies.map((body) => position(body, bodies.get(body.bodyId))),
    objectives: before.objectives.map((objective) => {
      const next = objectives.get(objective.objectiveId);
      return position(objective, next?.kind === objective.kind && next?.bodyId === objective.bodyId ? next : undefined);
    }),
  };
}

/** Rotate on the shortest 2D arc; an exact half-turn consistently rotates positive. */
function direction(ax: number, ay: number, bx: number, by: number, alpha: number): { x: number; y: number } {
  const lengthA = Math.hypot(ax, ay), lengthB = Math.hypot(bx, by);
  if (lengthA < 0.000001) return lengthB < 0.000001 ? { x: ax, y: ay } : { x: bx / lengthB, y: by / lengthB };
  if (lengthB < 0.000001) return { x: ax / lengthA, y: ay / lengthA };
  ax /= lengthA; ay /= lengthA; bx /= lengthB; by /= lengthB;
  const cross = ax * by - ay * bx, dot = ax * bx + ay * by;
  const angle = (Math.abs(cross) < 1e-12 && dot < 0 ? Math.PI : Math.atan2(cross, dot)) * alpha;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: ax * cos - ay * sin, y: ax * sin + ay * cos };
}
