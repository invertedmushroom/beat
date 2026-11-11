import type { EngineSnapshot, PlayerInput, Ruleset } from '../engine/protocol';
import { applyPlatformGravity } from '../engine/platformMovement';
import { displacePlayer, isArenaPositionBlocked, movementMultiplier, nextPlayerMovement, playerAim } from '../engine/playerMovement';
import { canStartCharge } from '../engine/charge';
import type { CollisionPrediction } from './collisionPrediction';

export const REMOTE_BUFFER_TICKS = 2;
export const MAX_EXTRAPOLATION_SECONDS = 0.15;
export const MAX_SNAPSHOT_HISTORY = 12;
export const LOCAL_RECONCILE_RATE = 9;
export const LOCAL_SNAP_DISTANCE = 2.4;
const MAX_PREDICTION_HISTORY = 128;
export type AlignedPrediction = Readonly<{ tick: number; x: number; y: number }>;
type PredictionStep = { steps: number; sequence: number; x: number; y: number };

type PlayerSnapshot = EngineSnapshot['players'][number];
type ProjectileSnapshot = EngineSnapshot['projectiles'][number];
type BodySnapshot = EngineSnapshot['physicsBodies'][number];
type ObjectiveSnapshot = EngineSnapshot['objectives'][number];
type MovingCircle = { x: number; y: number; vx: number; vy: number; radius: number };
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
  private readonly bodyHistory = new Map<string, Array<Timed<BodySnapshot>>>();
  private readonly objectiveHistory = new Map<string, Array<Timed<ObjectiveSnapshot>>>();
  private readonly extrapolatingIds = new Set<string>();
  private readonly predictionHistory = new Map<number, { x: number; y: number; sequence: number; respawnTick: number }>();
  private alignedPrediction?: AlignedPrediction;
  private correctionOffset = { x: 0, y: 0 };
  private correctionRate = LOCAL_RECONCILE_RATE;
  private lastRenderAtMs?: number;
  private predictionErrorEwma = 0;
  private predictionErrorMax = 0;
  private snapCorrections = 0;
  private remoteExtrapolationEvents = 0;
  private remoteExtrapolationSeconds = 0;
  private snapshotGapEwma = 0;
  private snapshotGapMax = 0;
  private pendingInputCount = 0;
  private collisionPrediction?: CollisionPrediction;
  private destroyed = false;
  readonly ready: Promise<void>;

  constructor(
    private readonly ruleset: Ruleset,
    private localPlayerId?: string,
  ) {
    this.ready = import('./collisionPrediction').then(({ CollisionPrediction }) => CollisionPrediction.create(ruleset)).then((prediction) => {
      if (this.destroyed) prediction.destroy();
      else this.collisionPrediction = prediction;
    }).catch((error: unknown) => console.warn('Remote collision prediction unavailable', error));
  }

  destroy(): void {
    this.destroyed = true;
    this.collisionPrediction?.destroy();
    this.collisionPrediction = undefined;
    this.predictionHistory.clear();
    this.bodyHistory.clear();
    this.objectiveHistory.clear();
    this.alignedPrediction = undefined;
  }

  setLocalPlayer(playerId: string | undefined): void {
    this.localPlayerId = playerId;
    this.predictionHistory.clear();
    this.alignedPrediction = undefined;
    this.correctionOffset = { x: 0, y: 0 };
  }

  pushAuthoritative(snapshot: EngineSnapshot, receivedAtMs = performance.now()): void {
    if (this.latest && snapshot.tick <= this.latest.tick) return;
    const player = snapshot.players.find((entry) => entry.playerId === this.localPlayerId);
    const previousPlayer = this.latest?.players.find((entry) => entry.playerId === this.localPlayerId);
    const sameLife = player?.alive && previousPlayer?.alive && player.respawnTick === previousPlayer.respawnTick;
    const predicted = this.predictionHistory.get(snapshot.tick);
    this.alignedPrediction = undefined;
    if (sameLife && predicted && predicted.sequence === player.lastInputSequence && predicted.respawnTick === player.respawnTick) {
      this.alignedPrediction = { tick: snapshot.tick, x: predicted.x, y: predicted.y };
      const error = distance(predicted, player);
      this.predictionErrorEwma = this.predictionErrorEwma * 0.9 + error * 0.1;
      this.predictionErrorMax = Math.max(this.predictionErrorMax, error);
      const { zero, soft, hard } = this.reconciliationThresholds();
      if (error > zero) {
        this.correctionOffset.x += predicted.x - player.x;
        this.correctionOffset.y += predicted.y - player.y;
      }
      const offset = Math.hypot(this.correctionOffset.x, this.correctionOffset.y);
      if (error >= hard || offset >= hard) { this.correctionOffset = { x: 0, y: 0 }; this.snapCorrections++; }
      this.correctionRate = LOCAL_RECONCILE_RATE + 15 * Math.max(0, Math.min(1, (offset - soft) / (hard - soft)));
    } else {
      // Coalesced inputs, missed predictions, and life changes have no matching
      // timeline. Accept the new anchor without manufacturing an error sample.
      this.correctionOffset = { x: 0, y: 0 };
    }
    if (!sameLife) this.predictionHistory.clear();
    for (const tick of this.predictionHistory.keys()) if (tick <= snapshot.tick) this.predictionHistory.delete(tick);
    if (this.latest && snapshot.tick > this.latest.tick) {
      const gap = (snapshot.tick - this.latest.tick) / this.ruleset.tickRate;
      this.snapshotGapEwma = this.snapshotGapEwma * 0.9 + gap * 0.1;
      this.snapshotGapMax = Math.max(this.snapshotGapMax, gap);
    }

    this.ingestDynamics(snapshot);
    this.latest = snapshot;
    this.latestReceivedAtMs = receivedAtMs;
    this.ingestPlayers(snapshot);
    this.ingestProjectiles(snapshot);
  }

  predictionAtTick(tick: number): AlignedPrediction | undefined {
    return this.alignedPrediction?.tick === tick ? this.alignedPrediction : undefined;
  }

  private reconciliationThresholds(): { zero: number; soft: number; hard: number } {
    return { zero: Math.max(0.001, Math.hypot(this.ruleset.arena.width, this.ruleset.arena.height) / 65535 * 2),
      soft: Math.max(0.15, this.ruleset.player.radius * 0.5), hard: Math.max(LOCAL_SNAP_DISTANCE, this.ruleset.player.radius * 5) };
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
    snapshot.physicsBodies = snapshot.physicsBodies.map((body) => this.interpolateCircle(body, this.bodyHistory.get(body.bodyId), renderTick));
    const bodies = new Map(snapshot.physicsBodies.map((body) => [body.bodyId, body]));
    snapshot.objectives = snapshot.objectives.map((objective) => {
      if (objective.kind !== 'relicPush') return objective;
      const body = objective.bodyId ? bodies.get(objective.bodyId) : undefined;
      const position = body ?? this.interpolateCircle(objective, this.objectiveHistory.get(objective.objectiveId), renderTick);
      return { ...objective, x: position.x, y: position.y, vx: position.vx, vy: position.vy };
    });
    return snapshot;
  }

  private ingestDynamics(snapshot: EngineSnapshot): void {
    for (const objective of snapshot.objectives) {
      const previous = this.latest?.objectives.find((entry) => entry.objectiveId === objective.objectiveId);
      if (!previous) continue;
      if (objective.scoreCooldownTicks > previous.scoreCooldownTicks || objective.bodyId !== previous.bodyId) {
        this.objectiveHistory.delete(objective.objectiveId);
        if (previous.bodyId) this.bodyHistory.delete(previous.bodyId);
        if (objective.bodyId) this.bodyHistory.delete(objective.bodyId);
      }
    }
    ingestHistory(this.bodyHistory, snapshot.tick, snapshot.physicsBodies, (body) => body.bodyId);
    ingestHistory(this.objectiveHistory, snapshot.tick, snapshot.objectives, (objective) => objective.objectiveId);
  }

  private interpolateCircle<T extends MovingCircle>(current: T, history: Array<Timed<T>> | undefined, renderTick: number): T {
    if (!history?.length) return current;
    const result = interpolateTimed(history, renderTick, this.ruleset.tickRate, (older, newer, t, extrapolateSeconds, spanSeconds = 0) => {
      // Dynamic contacts are authoritative. Hold at the newest anchor during a gap.
      if (extrapolateSeconds !== undefined) return newer;
      const point = {
        x: hermite(older.x, newer.x, older.vx, newer.vx, spanSeconds, t),
        y: hermite(older.y, newer.y, older.vy, newer.vy, spanSeconds, t),
      };
      const position = this.safeCirclePosition(point, older, newer, t);
      return { ...newer, ...position, vx: lerp(older.vx, newer.vx, t), vy: lerp(older.vy, newer.vy, t) };
    });
    // Keep lifetime and other gameplay fields at the latest authoritative state.
    return { ...current, x: result.value.x, y: result.value.y, vx: result.value.vx, vy: result.value.vy };
  }

  private safeCirclePosition(point: { x: number; y: number }, older: MovingCircle, newer: MovingCircle, t: number): { x: number; y: number } {
    if (!isArenaPositionBlocked(point, newer.radius, this.ruleset)) return point;
    const linear = { x: lerp(older.x, newer.x, t), y: lerp(older.y, newer.y, t) };
    if (!isArenaPositionBlocked(linear, newer.radius, this.ruleset)) return linear;
    return t < 0.5 ? { x: older.x, y: older.y } : { x: newer.x, y: newer.y };
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
    const target = replayPendingInputs(player, pendingInputs, this.ruleset, this.collisionPrediction?.stepLocal, (step) => {
      const tick = this.latest!.tick + step.steps;
      this.predictionHistory.set(tick, { x: step.x, y: step.y, sequence: step.sequence, respawnTick: player.respawnTick });
      while (this.predictionHistory.size > MAX_PREDICTION_HISTORY) this.predictionHistory.delete(this.predictionHistory.keys().next().value!);
    });
    const decay = Math.exp(-this.correctionRate * dt);
    this.correctionOffset.x *= decay; this.correctionOffset.y *= decay;
    if (Math.hypot(this.correctionOffset.x, this.correctionOffset.y) <= this.reconciliationThresholds().zero) this.correctionOffset = { x: 0, y: 0 };
    let next = { x: target.x + this.correctionOffset.x, y: target.y + this.correctionOffset.y };
    if ((this.correctionOffset.x !== 0 || this.correctionOffset.y !== 0) && isArenaPositionBlocked(next, this.ruleset.player.radius, this.ruleset)) {
      this.correctionOffset = { x: 0, y: 0 };
      next = target;
      this.snapCorrections++;
    }

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
    const result = interpolateTimed(history, renderTick, this.ruleset.tickRate, (older, newer, t, extrapolateSeconds) => {
      const facingDx = normalizeOr(lerp(older.facingDx, newer.facingDx, t), lerp(older.facingDy, newer.facingDy, t), {
        x: newer.facingDx,
        y: newer.facingDy,
      }).x;
      const facingDy = normalizeOr(lerp(older.facingDx, newer.facingDx, t), lerp(older.facingDy, newer.facingDy, t), {
        x: newer.facingDx,
        y: newer.facingDy,
      }).y;
      const isFacingAim = this.ruleset.player.aim.mode === 'facing';
      const aimDx = isFacingAim ? facingDx : normalizeOr(newer.aimDx, newer.aimDy, { x: newer.aimDx, y: newer.aimDy }).x;
      const aimDy = isFacingAim ? facingDy : normalizeOr(newer.aimDx, newer.aimDy, { x: newer.aimDx, y: newer.aimDy }).y;
      const predicted = extrapolateSeconds === undefined ? undefined : this.collisionPrediction?.predict(newer, extrapolateSeconds);

      return {
        ...newer,
        x: extrapolateSeconds === undefined ? lerp(older.x, newer.x, t) : predicted?.x ?? newer.x,
        y: extrapolateSeconds === undefined ? lerp(older.y, newer.y, t) : predicted?.y ?? newer.y,
        vx: predicted?.vx ?? newer.vx,
        vy: predicted?.vy ?? newer.vy,
        aimDx,
        aimDy,
        facingDx,
        facingDy,
      };
    });
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
  integrate?: (state: { x: number; y: number }, velocity: { x: number; y: number }) => { x: number; y: number; vx: number; vy: number },
  onStep?: (step: PredictionStep) => void,
): Pick<PlayerSnapshot, 'x' | 'y' | 'vx' | 'vy' | 'aimDx' | 'aimDy' | 'facingDx' | 'facingDy'> {
  if (!authoritative.alive) return authoritative;
  let x = authoritative.x, y = authoritative.y;
  let facing = normalizeOr(authoritative.facingDx, authoritative.facingDy, { x: 1, y: 0 });
  let aim = normalizeOr(authoritative.aimDx, authoritative.aimDy, facing);
  let velocity = { x: authoritative.vx, y: authoritative.vy };
  let jumpHeld = authoritative.jumpHeld ?? false;
  const dt = 1 / ruleset.tickRate;
  const abilities = ruleset.loadout.abilityIds.map((id) => ruleset.abilities.find((ability) => ability.id === id));
  const cooldowns = new Map<string, number>();
  abilities.forEach((ability, slot) => {
    if (ability) cooldowns.set(ability.id, Math.max(cooldowns.get(ability.id) ?? 0, authoritative.slotCooldownTicks[slot] ?? 0));
  });
  const statuses = authoritative.statuses.map((status) => ({ movementMultiplier: status.movementMultiplier, untilTick: status.remainingTicks }));
  if (authoritative.status) statuses.push({ movementMultiplier: authoritative.status.slowMultiplier, untilTick: authoritative.status.slowTicks });
  const chargedAbility = authoritative.charging && ruleset.abilities.find((ability) => ability.id === authoritative.charging!.abilityId);
  let charging = chargedAbility?.charge && authoritative.charging
    ? { ability: chargedAbility, slot: authoritative.charging.slot, startedStep: -authoritative.charging.chargeTicks }
    : undefined;
  let step = 0;
  let lastSequence = authoritative.lastInputSequence;
  const applyCast = (ability: NonNullable<typeof abilities[number]>) => {
    // Aim-assisted movement depends on authoritative target selection.
    if (ability.targeting !== 'free-aim') return;
    for (const effect of ability.effects ?? []) {
      if (effect.kind !== 'selfDash') continue;
      const displaced = displacePlayer({ x, y }, aim, effect.distance, ruleset);
      x = displaced.x; y = displaced.y;
    }
  };
  for (const input of pendingInputs.slice().sort((a, b) => a.sequence - b.sequence)) {
    if (input.sequence <= lastSequence) continue;
    lastSequence = input.sequence;
    for (const slot of input.slotPresses) {
      const ability = abilities[slot];
      if (canStartCharge(ability, Boolean(charging), (cooldowns.get(ability?.id ?? '') ?? 0) - step)) charging = { ability, slot, startedStep: step };
    }
    const next = nextPlayerMovement({ position: { x, y }, velocity, facing, jumpHeld }, input, ruleset,
      movementMultiplier(statuses, step) * (charging?.ability.charge?.moveSpeedMultiplier ?? 1));
    facing = next.facing;
    aim = playerAim(input, facing, ruleset.player);
    jumpHeld = next.jumpHeld;
    // The authority applies cast/release effects after desired movement is
    // selected, but before Rapier integrates that tick.
    for (const slot of input.castSlots) {
      const ability = abilities[slot];
      if (ability && !ability.charge && (cooldowns.get(ability.id) ?? 0) <= step) {
        cooldowns.set(ability.id, step + ability.cooldownTicks);
        applyCast(ability);
      }
    }
    if (charging && (input.slotReleases.includes(charging.slot) || (charging.ability.charge!.autoRelease && step - charging.startedStep >= charging.ability.charge!.maxTicks))) {
      cooldowns.set(charging.ability.id, step + charging.ability.cooldownTicks);
      applyCast(charging.ability);
      charging = undefined;
    }
    if (integrate) {
      const integrated = integrate({ x, y }, next.velocity);
      x = integrated.x; y = integrated.y;
      velocity = { x: integrated.vx, y: integrated.vy };
    } else {
      // Used before WASM is ready; authoritative Rapier integration replaces
      // this approximation in the live smoother as soon as it is available.
      velocity = ruleset.player.movement.mode === 'platform'
        ? applyPlatformGravity(next.velocity, ruleset.player.movement.platform.gravity, ruleset.player.movement.platform.maxFallSpeed, dt)
        : next.velocity;
      x += velocity.x * dt; y += velocity.y * dt;
      const damping = 1 + ruleset.player.damping * dt;
      velocity = { x: velocity.x / damping, y: velocity.y / damping };
    }
    step++;
    onStep?.({ steps: step, sequence: input.sequence, x, y });
  }
  if (ruleset.player.aim.mode === 'facing') aim = facing;
  return { x, y, vx: velocity.x, vy: velocity.y, aimDx: aim.x, aimDy: aim.y, facingDx: facing.x, facingDy: facing.y };
}

function interpolateTimed<T>(
  history: Array<Timed<T>>,
  renderTick: number,
  tickRate: number,
  build: (older: T, newer: T, t: number, extrapolateSeconds?: number, spanSeconds?: number) => T,
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
  return { value: build(older.value, newer.value, (renderTick - older.tick) / span, undefined, span / tickRate), extrapolating: false, extrapolatedSeconds: 0 };
}

function ingestHistory<T>(history: Map<string, Array<Timed<T>>>, tick: number, values: T[], id: (value: T) => string): void {
  const live = new Set<string>();
  for (const value of values) {
    const key = id(value);
    live.add(key);
    const samples = history.get(key) ?? [];
    samples.push({ tick, value: { ...value } });
    trimHistory(samples);
    history.set(key, samples);
  }
  for (const key of history.keys()) if (!live.has(key)) history.delete(key);
}

function hermite(start: number, end: number, startVelocity: number, endVelocity: number, seconds: number, t: number): number {
  const s2 = t * t, s3 = s2 * t;
  return (2 * s3 - 3 * s2 + 1) * start + (s3 - 2 * s2 + t) * startVelocity * seconds +
    (-2 * s3 + 3 * s2) * end + (s3 - s2) * endVelocity * seconds;
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
