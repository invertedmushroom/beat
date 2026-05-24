import type { EngineSnapshot, PlayerInput, Ruleset } from '../engine/protocol';

export const REMOTE_BUFFER_TICKS = 2;
export const MAX_EXTRAPOLATION_SECONDS = 0.15;
export const MAX_SNAPSHOT_HISTORY = 12;
export const LOCAL_RECONCILE_RATE = 9;
export const LOCAL_SNAP_DISTANCE = 2.4;

type PlayerSnapshot = EngineSnapshot['players'][number];
type ProjectileSnapshot = EngineSnapshot['projectiles'][number];
type Timed<T> = {
  tick: number;
  value: T;
};

export type SnapshotSmoothingStats = {
  predictionErrorEwma: number;
  predictionErrorMax: number;
  snapCorrections: number;
  pendingInputs: number;
  remoteExtrapolationEvents: number;
  remoteExtrapolationSeconds: number;
  snapshotGapEwma: number;
  snapshotGapMax: number;
};

export class SnapshotSmoother {
  private latest?: EngineSnapshot;
  private latestReceivedAtMs = 0;
  private readonly playerHistory = new Map<string, Array<Timed<PlayerSnapshot>>>();
  private readonly projectileHistory = new Map<string, Array<Timed<ProjectileSnapshot>>>();
  private readonly extrapolatingIds = new Set<string>();
  private renderedLocal?: { x: number; y: number };
  private lastRenderAtMs?: number;
  private predictionErrorEwma = 0;
  private predictionErrorMax = 0;
  private snapCorrections = 0;
  private remoteExtrapolationEvents = 0;
  private remoteExtrapolationSeconds = 0;
  private snapshotGapEwma = 0;
  private snapshotGapMax = 0;
  private measuredPredictionTick = -1;
  private pendingInputCount = 0;

  constructor(
    private readonly ruleset: Ruleset,
    private localPlayerId?: string,
  ) {}

  setLocalPlayer(playerId: string | undefined): void {
    this.localPlayerId = playerId;
    this.renderedLocal = undefined;
  }

  pushAuthoritative(snapshot: EngineSnapshot, receivedAtMs = performance.now()): void {
    if (this.latest && snapshot.tick > this.latest.tick) {
      const gap = (snapshot.tick - this.latest.tick) / this.ruleset.tickRate;
      this.snapshotGapEwma = this.snapshotGapEwma * 0.9 + gap * 0.1;
      this.snapshotGapMax = Math.max(this.snapshotGapMax, gap);
    }

    this.latest = snapshot;
    this.latestReceivedAtMs = receivedAtMs;
    this.ingestPlayers(snapshot);
    this.ingestProjectiles(snapshot);
  }

  render(nowMs: number, pendingInputs: readonly PlayerInput[] = []): EngineSnapshot | undefined {
    if (!this.latest) {
      return undefined;
    }

    const dt = this.lastRenderAtMs === undefined ? 0 : Math.max(0, Math.min(0.1, (nowMs - this.lastRenderAtMs) / 1000));
    this.lastRenderAtMs = nowMs;
    this.pendingInputCount = pendingInputs.length;

    const snapshot = cloneSnapshot(this.latest);
    const elapsedTicks = this.latestReceivedAtMs > 0 ? ((nowMs - this.latestReceivedAtMs) / 1000) * this.ruleset.tickRate : 0;
    const renderTick = this.latest.tick + Math.max(0, elapsedTicks) - REMOTE_BUFFER_TICKS;

    snapshot.players = snapshot.players.map((player) => {
      if (player.playerId === this.localPlayerId) {
        return this.predictLocalPlayer(player, pendingInputs, dt);
      }
      return this.interpolatePlayer(player, renderTick, dt);
    });
    snapshot.projectiles = snapshot.projectiles.map((projectile) => this.interpolateProjectile(projectile, renderTick, dt));
    return snapshot;
  }

  stats(): SnapshotSmoothingStats {
    return {
      predictionErrorEwma: this.predictionErrorEwma,
      predictionErrorMax: this.predictionErrorMax,
      snapCorrections: this.snapCorrections,
      pendingInputs: this.pendingInputCount,
      remoteExtrapolationEvents: this.remoteExtrapolationEvents,
      remoteExtrapolationSeconds: this.remoteExtrapolationSeconds,
      snapshotGapEwma: this.snapshotGapEwma,
      snapshotGapMax: this.snapshotGapMax,
    };
  }

  private ingestPlayers(snapshot: EngineSnapshot): void {
    const liveIds = new Set<string>();
    for (const player of snapshot.players) {
      liveIds.add(player.playerId);
      const history = this.playerHistory.get(player.playerId) ?? [];
      if (history[history.length - 1]?.tick !== snapshot.tick) {
        history.push({ tick: snapshot.tick, value: { ...player } });
      }
      trimHistory(history);
      this.playerHistory.set(player.playerId, history);
    }
    for (const playerId of this.playerHistory.keys()) {
      if (!liveIds.has(playerId)) {
        this.playerHistory.delete(playerId);
      }
    }
  }

  private ingestProjectiles(snapshot: EngineSnapshot): void {
    const liveIds = new Set<string>();
    for (const projectile of snapshot.projectiles) {
      liveIds.add(projectile.projectileId);
      const history = this.projectileHistory.get(projectile.projectileId) ?? [];
      if (history[history.length - 1]?.tick !== snapshot.tick) {
        history.push({ tick: snapshot.tick, value: { ...projectile } });
      }
      trimHistory(history);
      this.projectileHistory.set(projectile.projectileId, history);
    }
    for (const projectileId of this.projectileHistory.keys()) {
      if (!liveIds.has(projectileId)) {
        this.projectileHistory.delete(projectileId);
      }
    }
  }

  private predictLocalPlayer(player: PlayerSnapshot, pendingInputs: readonly PlayerInput[], dt: number): PlayerSnapshot {
    const target = replayPendingInputs(player, pendingInputs, this.ruleset);
    const current = this.renderedLocal ?? { x: player.x, y: player.y };
    const correction = distance(current, target);

    if (this.latest && this.measuredPredictionTick !== this.latest.tick) {
      this.predictionErrorEwma = this.predictionErrorEwma * 0.9 + correction * 0.1;
      this.predictionErrorMax = Math.max(this.predictionErrorMax, correction);
      this.measuredPredictionTick = this.latest.tick;
    }

    const shouldSnap = correction > LOCAL_SNAP_DISTANCE;
    const blend = shouldSnap ? 1 : Math.min(1, dt * LOCAL_RECONCILE_RATE);
    if (shouldSnap) {
      this.snapCorrections += 1;
    }

    const next = {
      x: current.x + (target.x - current.x) * blend,
      y: current.y + (target.y - current.y) * blend,
    };
    this.renderedLocal = next;

    return {
      ...player,
      x: next.x,
      y: next.y,
      vx: target.vx,
      vy: target.vy,
      facingDx: target.facingDx,
      facingDy: target.facingDy,
      aimDx: target.aimDx,
      aimDy: target.aimDy,
    };
  }

  private interpolatePlayer(player: PlayerSnapshot, renderTick: number, dt: number): PlayerSnapshot {
    const history = this.playerHistory.get(player.playerId);
    if (!history || history.length === 0) {
      return player;
    }
    const result = interpolateTimed(history, renderTick, this.ruleset.tickRate, (older, newer, t, extrapolateSeconds) => ({
      ...newer,
      x: extrapolateSeconds === undefined ? lerp(older.x, newer.x, t) : newer.x + newer.vx * extrapolateSeconds,
      y: extrapolateSeconds === undefined ? lerp(older.y, newer.y, t) : newer.y + newer.vy * extrapolateSeconds,
      vx: newer.vx,
      vy: newer.vy,
      aimDx: normalizeOr(newer.aimDx, newer.aimDy, { x: newer.aimDx, y: newer.aimDy }).x,
      aimDy: normalizeOr(newer.aimDx, newer.aimDy, { x: newer.aimDx, y: newer.aimDy }).y,
      facingDx: normalizeOr(lerp(older.facingDx, newer.facingDx, t), lerp(older.facingDy, newer.facingDy, t), {
        x: newer.facingDx,
        y: newer.facingDy,
      }).x,
      facingDy: normalizeOr(lerp(older.facingDx, newer.facingDx, t), lerp(older.facingDy, newer.facingDy, t), {
        x: newer.facingDx,
        y: newer.facingDy,
      }).y,
    }));
    this.noteExtrapolation(`player:${player.playerId}`, result.extrapolating, result.extrapolatedSeconds, dt);
    return result.value;
  }

  private interpolateProjectile(projectile: ProjectileSnapshot, renderTick: number, dt: number): ProjectileSnapshot {
    const history = this.projectileHistory.get(projectile.projectileId);
    if (!history || history.length === 0) {
      return projectile;
    }
    const result = interpolateTimed(history, renderTick, this.ruleset.tickRate, (older, newer, t, extrapolateSeconds) => {
      if (extrapolateSeconds === undefined) {
        return {
          ...newer,
          x: lerp(older.x, newer.x, t),
          y: lerp(older.y, newer.y, t),
        };
      }
      const tickSeconds = Math.max(1 / this.ruleset.tickRate, (newestTick(history) - olderTick(history)) / this.ruleset.tickRate);
      return {
        ...newer,
        x: newer.x + ((newer.x - older.x) / tickSeconds) * extrapolateSeconds,
        y: newer.y + ((newer.y - older.y) / tickSeconds) * extrapolateSeconds,
      };
    });
    this.noteExtrapolation(`projectile:${projectile.projectileId}`, result.extrapolating, result.extrapolatedSeconds, dt);
    return result.value;
  }

  private noteExtrapolation(id: string, extrapolating: boolean, extrapolatedSeconds: number, dt: number): void {
    if (!extrapolating) {
      this.extrapolatingIds.delete(id);
      return;
    }
    if (!this.extrapolatingIds.has(id)) {
      this.remoteExtrapolationEvents += 1;
      this.extrapolatingIds.add(id);
    }
    this.remoteExtrapolationSeconds += dt > 0 ? Math.min(dt, extrapolatedSeconds) : extrapolatedSeconds;
  }
}

export function replayPendingInputs(
  authoritative: PlayerSnapshot,
  pendingInputs: readonly PlayerInput[],
  ruleset: Ruleset,
): Pick<PlayerSnapshot, 'x' | 'y' | 'vx' | 'vy' | 'aimDx' | 'aimDy' | 'facingDx' | 'facingDy'> {
  let x = authoritative.x;
  let y = authoritative.y;
  let facing = normalizeOr(authoritative.facingDx, authoritative.facingDy, { x: 1, y: 0 });
  let aim = normalizeOr(authoritative.aimDx, authoritative.aimDy, facing);
  let velocity = { x: authoritative.vx, y: authoritative.vy };
  const dt = 1 / ruleset.tickRate;

  for (const input of pendingInputs.slice().sort((a, b) => a.sequence - b.sequence)) {
    aim = normalizeOr(input.aimDx, input.aimDy, aim);
    if (ruleset.player.movement.mode === 'tank') {
      const turnRadians = (ruleset.player.movement.turnSpeedDegrees * Math.PI) / 180 / ruleset.tickRate;
      facing = rotate(facing, clamp(input.moveX, -1, 1) * turnRadians);
      const throttle = clamp(-input.moveY, -1, 1);
      const reverseMultiplier = throttle < 0 ? ruleset.player.movement.reverseMultiplier : 1;
      const speed = ruleset.player.speed * reverseMultiplier * throttle;
      velocity = { x: facing.x * speed, y: facing.y * speed };
    } else {
      const move = normalized(input.moveX, input.moveY);
      velocity = move ? { x: move.x * ruleset.player.speed, y: move.y * ruleset.player.speed } : { x: 0, y: 0 };
      if (ruleset.player.aim.mode === 'free') {
        facing = aim;
      } else if (move) {
        facing = move;
      }
    }
    x += velocity.x * dt;
    y += velocity.y * dt;
  }

  return {
    x,
    y,
    vx: velocity.x,
    vy: velocity.y,
    aimDx: aim.x,
    aimDy: aim.y,
    facingDx: facing.x,
    facingDy: facing.y,
  };
}

function interpolateTimed<T>(
  history: Array<Timed<T>>,
  renderTick: number,
  tickRate: number,
  build: (older: T, newer: T, t: number, extrapolateSeconds?: number) => T,
): { value: T; extrapolating: boolean; extrapolatedSeconds: number } {
  const oldest = history[0];
  const newest = history[history.length - 1];
  if (!oldest || !newest || history.length === 1 || renderTick <= oldest.tick) {
    return { value: oldest?.value ?? newest.value, extrapolating: false, extrapolatedSeconds: 0 };
  }

  if (renderTick >= newest.tick) {
    const previous = history[history.length - 2] ?? newest;
    const extrapolatedSeconds = Math.min(MAX_EXTRAPOLATION_SECONDS, Math.max(0, (renderTick - newest.tick) / tickRate));
    return {
      value: build(previous.value, newest.value, 1, extrapolatedSeconds),
      extrapolating: extrapolatedSeconds > 0,
      extrapolatedSeconds,
    };
  }

  let older = oldest;
  let newer = newest;
  for (let index = 1; index < history.length; index += 1) {
    const candidate = history[index];
    if (candidate && candidate.tick >= renderTick) {
      older = history[index - 1] ?? oldest;
      newer = candidate;
      break;
    }
  }
  const span = Math.max(1, newer.tick - older.tick);
  return { value: build(older.value, newer.value, (renderTick - older.tick) / span), extrapolating: false, extrapolatedSeconds: 0 };
}

function cloneSnapshot(snapshot: EngineSnapshot): EngineSnapshot {
  return {
    ...snapshot,
    match: {
      ...snapshot.match,
      teams: snapshot.match.teams.map((team) => ({ ...team })),
    },
    objectives: snapshot.objectives.map((objective) => ({
      ...objective,
      zones: objective.zones.map((zone) => ({ ...zone })),
    })),
    players: snapshot.players.map((player) => ({
      ...player,
      slotCooldownTicks: player.slotCooldownTicks.slice(),
      statuses: player.statuses.map((status) => ({ ...status, tags: status.tags.slice() })),
      resources: player.resources.map((resource) => ({ ...resource })),
      status: player.status ? { ...player.status } : undefined,
      charging: player.charging ? { ...player.charging } : undefined,
    })),
    projectiles: snapshot.projectiles.map((projectile) => ({ ...projectile })),
    physicsBodies: snapshot.physicsBodies.map((body) => ({ ...body })),
    constraints: snapshot.constraints.map((constraint) => ({ ...constraint })),
    effects: snapshot.effects.map((effect) => ({ ...effect })),
    combatTexts: snapshot.combatTexts.map((text) => ({ ...text })),
    mechanicTraces: snapshot.mechanicTraces.map((trace) => ({ ...trace })),
    aiTraces: snapshot.aiTraces.map((trace) => ({ ...trace })),
  };
}

function trimHistory<T>(history: Array<Timed<T>>): void {
  while (history.length > MAX_SNAPSHOT_HISTORY) {
    history.shift();
  }
}

function newestTick<T>(history: Array<Timed<T>>): number {
  return history[history.length - 1]?.tick ?? 0;
}

function olderTick<T>(history: Array<Timed<T>>): number {
  return history[history.length - 2]?.tick ?? newestTick(history);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalized(x: number, y: number): { x: number; y: number } | undefined {
  const mag = Math.hypot(x, y);
  return mag > 0.001 ? { x: x / mag, y: y / mag } : undefined;
}

function normalizeOr(x: number, y: number, fallback: { x: number; y: number }): { x: number; y: number } {
  return normalized(x, y) ?? fallback;
}

function rotate(vector: { x: number; y: number }, radians: number): { x: number; y: number } {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalizeOr(vector.x * cos - vector.y * sin, vector.x * sin + vector.y * cos, vector);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
