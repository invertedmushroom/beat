import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { EngineSnapshot, PlayerInput } from '../engine/protocol';
import { fromNetworkSnapshot, toNetworkSnapshot } from './compactSnapshot';
import { PendingInputQueue } from './pendingInputs';
import { replayPendingInputs, SnapshotSmoother } from './snapshotSmoothing';
import { nextPlayerMovement, playerAim } from '../engine/playerMovement';
import { CollisionPrediction } from './collisionPrediction';
import RAPIER from '@dimforge/rapier2d-compat';

describe('responsive netcode helpers', () => {
  it('strips debug traces from network snapshots and restores render shape', () => {
    const snapshot = snapshotAt(4, [playerAt('p1', 0, 0)]);
    snapshot.mechanicTraces = [{ traceId: 'trace', tick: 4, kind: 'event', result: 'queued' }];
    snapshot.aiTraces = [{ traceId: 'ai', tick: 4, kind: 'target', actorId: 'npc', result: 'none' }];

    const network = toNetworkSnapshot(snapshot);
    expect('mechanicTraces' in network).toBe(false);
    expect('aiTraces' in network).toBe(false);
    expect(fromNetworkSnapshot(network).mechanicTraces).toEqual([]);
  });

  it('acks pending inputs and keeps only recent redundant skill events', () => {
    const queue = new PendingInputQueue();
    queue.push(input(1, { castSlots: [0] }));
    queue.push(input(2));
    queue.push(input(3, { slotPresses: [3] }));

    expect(queue.snapshot().map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(queue.redundantEventInputs().map((entry) => entry.sequence)).toEqual([1, 3]);

    queue.ackUpTo(2);
    expect(queue.snapshot().map((entry) => entry.sequence)).toEqual([3]);
    expect(queue.highestAcked()).toBe(2);
  });

  it('replays unacked movement from the authoritative local player', () => {
    const ruleset = createDefaultRuleset();
    const replay = replayPendingInputs(playerAt('local', 0, 0), [input(2, { moveX: 1 })], ruleset);

    expect(replay.x).toBeCloseTo(ruleset.player.speed / ruleset.tickRate);
    expect(replay.y).toBeCloseTo(0);
    expect(replay.vx).toBeCloseTo(ruleset.player.speed / (1 + ruleset.player.damping / ruleset.tickRate));
  });

  it('predicts the strongest active slow and lets it expire on the correct step', () => {
    const rules = createDefaultRuleset();
    const player = playerAt('local', 0, 0);
    player.statuses = [
      { id: 'slow', name: 'Slow', color: '#fff', tags: [], stacks: 1, durationTicks: 10, remainingTicks: 1, movementMultiplier: 0.5 },
      { id: 'weaker', name: 'Weak slow', color: '#fff', tags: [], stacks: 1, durationTicks: 10, remainingTicks: 2, movementMultiplier: 0.8 },
    ];
    const replay = replayPendingInputs(player, [input(2, { moveX: 1 }), input(3, { moveX: 1 })], rules);
    expect(replay.x).toBeCloseTo(rules.player.speed / rules.tickRate * 1.3);
    expect(replay.vx).toBeCloseTo(rules.player.speed * 0.8 / (1 + rules.player.damping / rules.tickRate));
  });

  it('predicts a pending charge press, its release ordering, and subsequent normal movement', () => {
    const rules = createDefaultRuleset();
    const ability = rules.abilities.find((ability) => ability.charge)!;
    rules.loadout.abilityIds[0] = ability.id;
    const replay = replayPendingInputs(playerAt('local', 0, 0), [
      input(2, { moveX: 1, slotPresses: [0] }), input(3, { moveX: 1, slotReleases: [0] }), input(4, { moveX: 1 }),
    ], rules);
    expect(replay.x).toBeCloseTo(rules.player.speed / rules.tickRate * (2 * ability.charge!.moveSpeedMultiplier + 1));
  });

  it('snaps large local prediction corrections and reports the error', () => {
    const ruleset = createDefaultRuleset();
    const smoother = new SnapshotSmoother(ruleset, 'local');
    smoother.pushAuthoritative(snapshotAt(10, [playerAt('local', 0, 0)]), 0);

    const rendered = smoother.render(
      0,
      Array.from({ length: 20 }, (_, index) => input(index + 11, { moveX: 1 })),
    );

    const local = rendered?.players.find((player) => player.playerId === 'local');
    expect(local?.x).toBeGreaterThan(5);
    expect(smoother.stats().snapCorrections).toBe(1);
    expect(smoother.stats().predictionErrorMax).toBeGreaterThan(5);
    smoother.destroy();
  });

  it('honors charge cooldown and stops replaying movement for dead players', () => {
    const rules = createDefaultRuleset();
    const ability = rules.abilities.find((ability) => ability.charge)!;
    rules.loadout.abilityIds[0] = ability.id;
    const player = playerAt('local', 0, 0);
    const inputs = [input(2, { moveX: 1, slotPresses: [0] }), input(3, { moveX: 1 }), input(4, { moveX: 1 })];
    expect(replayPendingInputs(player, inputs, rules).x).toBeCloseTo(3 * rules.player.speed / rules.tickRate * ability.charge!.moveSpeedMultiplier);
    player.slotCooldownTicks[0] = 10;
    expect(replayPendingInputs(player, inputs, rules).x).toBeCloseTo(3 * rules.player.speed / rules.tickRate);
    player.alive = false;
    expect(replayPendingInputs(player, inputs, rules).x).toBe(0);
  });

  it('auto-releases an existing charge after movement at its deadline', () => {
    const rules = createDefaultRuleset();
    const ability = rules.abilities.find((ability) => ability.charge)!;
    const player = playerAt('local', 0, 0);
    player.charging = { abilityId: ability.id, slot: 0, chargeTicks: ability.charge!.maxTicks, maxTicks: ability.charge!.maxTicks, ratio: 1, aimDx: 1, aimDy: 0 };
    const replay = replayPendingInputs(player, [input(2, { moveX: 1 }), input(3, { moveX: 1 })], rules);
    expect(replay.x).toBeCloseTo(rules.player.speed / rules.tickRate * (ability.charge!.moveSpeedMultiplier + 1));
  });

  it('shares orthogonal, tank, and free-aim movement semantics', () => {
    const rules = createDefaultRuleset();
    const state = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, jumpHeld: false };
    rules.player.movement.mode = 'orthogonal';
    rules.player.aim.mode = 'free';
    const diagonal = input(2, { moveX: 1, moveY: 1, aimDx: 0, aimDy: 0 });
    const next = nextPlayerMovement(state, diagonal, rules, 0.5);
    expect(next.velocity).toEqual({ x: rules.player.speed * 0.5, y: 0 });
    expect(playerAim(diagonal, next.facing, rules.player).x).toBeCloseTo(Math.SQRT1_2);
    expect(playerAim(diagonal, next.facing, rules.player).y).toBeCloseTo(Math.SQRT1_2);
    rules.player.movement.mode = 'tank';
    const turn = rules.player.movement.turnSpeedDegrees * Math.PI / 180 / rules.tickRate;
    const tank = nextPlayerMovement(state, input(2, { moveX: 1, moveY: 1 }), rules, 1);
    expect(tank.facing.x).toBeCloseTo(Math.cos(turn));
    expect(tank.velocity.y).toBeCloseTo(-Math.sin(turn) * rules.player.speed * rules.player.movement.reverseMultiplier);
    expect(playerAim(input(2, { aimDx: 0, aimDy: 0 }), tank.facing, rules.player)).toEqual(tank.facing);
  });

  it('does not re-jump when a held platform input crosses an authoritative snapshot', () => {
    const rules = createDefaultRuleset();
    rules.player.movement.mode = 'platform';
    rules.obstacles = [];
    const player = playerAt('local', 0, rules.arena.height / 2 - rules.player.radius);
    player.jumpHeld = true;
    expect(replayPendingInputs(player, [input(2, { moveY: -1 })], rules).vy).toBeGreaterThan(0);
    player.jumpHeld = false;
    expect(replayPendingInputs(player, [input(2, { moveY: -1 })], rules).vy).toBeLessThan(0);
  });

  it('matches an independent Rapier step with damping and platform gravity', async () => {
    const rules = createDefaultRuleset();
    rules.player.movement.mode = 'platform';
    rules.obstacles = [];
    const prediction = await CollisionPrediction.create(rules);
    const world = new RAPIER.World({ x: 0, y: rules.player.movement.platform.gravity });
    try {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0).setLinvel(4, -2)
        .setLinearDamping(rules.player.damping).lockRotations().setCanSleep(false).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.ball(rules.player.radius).setFriction(0).setRestitution(0), body);
      world.timestep = 1 / rules.tickRate;
      world.step();
      const step = prediction.stepLocal({ x: 0, y: 0 }, { x: 4, y: -2 });
      expect(step.x).toBeCloseTo(body.translation().x, 6);
      expect(step.y).toBeCloseTo(body.translation().y, 6);
      expect(step.vx).toBeCloseTo(body.linvel().x, 6);
      expect(step.vy).toBeCloseTo(body.linvel().y, 6);
    } finally { prediction.destroy(); world.free(); }
  });

  it('replays local movement against a wall and restores remote damping independently', async () => {
    const rules = createDefaultRuleset();
    rules.obstacles = [{ id: 'wall', x: 1, y: 0, halfWidth: 0.1, halfHeight: 4 }];
    const prediction = await CollisionPrediction.create(rules);
    try {
      const replay = replayPendingInputs(playerAt('local', 0, 0), Array.from({ length: 20 }, (_, n) => input(n + 2, { moveX: 1 })), rules, prediction.stepLocal);
      expect(replay.x).toBeLessThan(1 - 0.1 - rules.player.radius + 0.02);
      const remote = playerAt('remote', -5, 0, 3);
      const first = prediction.predict(remote, 1 / rules.tickRate);
      expect(first.vx).toBeCloseTo(3, 6);
      expect(prediction.predict(remote, 1 / rules.tickRate)).toEqual(first);
    } finally { prediction.destroy(); }
  });

  it('interpolates remote players and extrapolates briefly when the stream stalls', async () => {
    const ruleset = createDefaultRuleset();
    const smoother = new SnapshotSmoother(ruleset, 'local');
    await smoother.ready;
    smoother.pushAuthoritative(snapshotAt(1, [playerAt('remote', 0, 0, 3)]), 0);
    smoother.pushAuthoritative(snapshotAt(2, [playerAt('remote', 1, 0, 3)]), 33);

    const rendered = smoother.render(233);
    const remote = rendered?.players.find((player) => player.playerId === 'remote');

    expect(remote?.x).toBeGreaterThan(1.25);
    expect(smoother.stats().remoteExtrapolationEvents).toBe(1);
    expect(smoother.stats().remoteExtrapolationSeconds).toBeGreaterThan(0);
    smoother.destroy();
  });
});

function snapshotAt(tick: number, players: EngineSnapshot['players']): EngineSnapshot {
  return {
    tick,
    nowMs: tick * 33,
    rulesetId: 'test',
    match: {
      elapsedTicks: tick,
      remainingTicks: 100,
      durationTicks: 100,
      scoreLimit: 1,
      finished: false,
      teams: [],
    },
    objectives: [],
    players,
    projectiles: [],
    physicsBodies: [],
    constraints: [],
    effects: [],
    combatTexts: [],
    mechanicTraces: [],
    aiTraces: [],
  };
}

function playerAt(playerId: string, x: number, y: number, vx = 0): EngineSnapshot['players'][number] {
  return {
    playerId,
    displayName: playerId,
    x,
    y,
    vx,
    vy: 0,
    hue: 120,
    hp: 100,
    maxHp: 100,
    alive: true,
    respawnTick: 0,
    slotCooldownTicks: [0, 0, 0, 0],
    lastUsedSlot: 0,
    aimDx: 1,
    aimDy: 0,
    facingDx: 1,
    facingDy: 0,
    role: 'player',
    team: 'players',
    statuses: [],
    resources: [],
    lastInputSequence: 1,
  };
}

function input(
  sequence: number,
  overrides: Partial<Pick<PlayerInput, 'moveX' | 'moveY' | 'aimDx' | 'aimDy' | 'castSlots' | 'slotPresses' | 'slotReleases'>> = {},
): PlayerInput {
  return {
    sequence,
    moveX: overrides.moveX ?? 0,
    moveY: overrides.moveY ?? 0,
    aimDx: overrides.aimDx ?? 1,
    aimDy: overrides.aimDy ?? 0,
    castSlots: overrides.castSlots ?? [],
    slotPresses: overrides.slotPresses ?? [],
    slotReleases: overrides.slotReleases ?? [],
    sampledAtMs: sequence * 10,
  };
}
