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
    expect(replay.x).toBeCloseTo(2.2 + rules.player.speed / rules.tickRate * (2 * ability.charge!.moveSpeedMultiplier + 1));
  });

  it('renders normal prediction immediately and snaps only a large aligned correction', () => {
    const ruleset = createDefaultRuleset();
    const smoother = new SnapshotSmoother(ruleset, 'local');
    smoother.pushAuthoritative(snapshotAt(10, [playerAt('local', 0, 0)]), 0);

    const rendered = smoother.render(
      0,
      Array.from({ length: 20 }, (_, index) => input(index + 11, { moveX: 1 })),
    );

    const local = rendered?.players.find((player) => player.playerId === 'local');
    expect(local?.x).toBeGreaterThan(5);
    expect(smoother.stats().snapCorrections).toBe(0);
    expect(smoother.stats().predictionErrorMax).toBe(0);
    smoother.pushAuthoritative(snapshotAt(11, [{ ...playerAt('local', -6, 0), lastInputSequence: 11 }]), 33);
    expect(smoother.render(33)?.players[0].x).toBe(-6);
    expect(smoother.stats().snapCorrections).toBe(1);
    expect(smoother.stats().predictionErrorMax).toBeGreaterThan(5);
    smoother.destroy();
  });

  it('records prediction before authority arrives and matches tick, input sequence, and life state', () => {
    const rules = createDefaultRuleset();
    const smoother = new SnapshotSmoother(rules, 'local');
    try {
      smoother.pushAuthoritative(snapshotAt(10, [playerAt('local', 0, 0)]), 0);
      smoother.render(0, [input(2, { moveX: 1 }), input(3, { moveX: 1 })]);
      smoother.pushAuthoritative(snapshotAt(11, [{ ...playerAt('local', 0.5, 0), lastInputSequence: 2 }]), 33);
      expect(smoother.predictionAtTick(11)?.x).toBeCloseTo(rules.player.speed / rules.tickRate);
      expect(smoother.stats().predictionErrorMax).toBeCloseTo(0.5 - rules.player.speed / rules.tickRate);
      smoother.render(33, [input(3, { moveX: 1 })]);
      smoother.pushAuthoritative(snapshotAt(12, [{ ...playerAt('local', 0.7, 0), lastInputSequence: 4 }]), 66);
      expect(smoother.predictionAtTick(12)).toBeUndefined();
      smoother.render(66, [input(5, { moveX: 1 })]);
      smoother.pushAuthoritative(snapshotAt(13, [{ ...playerAt('local', 0.8, 0), lastInputSequence: 5, respawnTick: 13 }]), 99);
      expect(smoother.predictionAtTick(13)).toBeUndefined();
      smoother.setLocalPlayer('other');
      expect(smoother.predictionAtTick(11)).toBeUndefined();
    } finally { smoother.destroy(); }
  });

  it('decays small correction offsets independently of render rate and ignores quantization noise', () => {
    const rules = createDefaultRuleset();
    const run = (frames: number, error: number): number => {
      const smoother = new SnapshotSmoother(rules, 'local');
      try {
        smoother.pushAuthoritative(snapshotAt(10, [playerAt('local', 0, 0)]), 0);
        const predicted = smoother.render(0, [input(2, { moveX: 1 })])!.players[0].x;
        const actual = predicted - error;
        smoother.pushAuthoritative(snapshotAt(11, [{ ...playerAt('local', actual, 0), lastInputSequence: 2 }]), 1);
        let rendered = actual;
        for (let n = 1; n <= frames; n++) rendered = smoother.render(n * 200 / frames)!.players[0].x;
        expect(smoother.stats().snapCorrections).toBe(0);
        return rendered - actual;
      } finally { smoother.destroy(); }
    };
    expect(run(6, 0.1)).toBeCloseTo(run(24, 0.1), 6);
    expect(run(12, 0.1)).toBeCloseTo(0.1 * Math.exp(-9 * 0.2), 6);
    expect(run(12, 0.00001)).toBe(0);
    expect(run(12, 0.8) / 0.8).toBeLessThan(run(12, 0.1) / 0.1);
  });

  it('predicts a charged dash once, before physics, with the same static collision limit', () => {
    const rules = createDefaultRuleset();
    const ability = rules.abilities.find((ability) => ability.charge)!;
    rules.loadout.abilityIds[0] = ability.id;
    rules.obstacles = [{ id: 'wall', x: 1.5, y: 0, halfWidth: 0.1, halfHeight: 5 }];
    const player = playerAt('local', 0, 0);
    const replay = replayPendingInputs(player, [input(2, { slotPresses: [0] }), input(3, { slotReleases: [0] }),
      input(3, { slotReleases: [0] }), input(4, { slotReleases: [0] })], rules);
    expect(replay.x).toBeGreaterThan(0.5);
    expect(replay.x).toBeLessThan(1.5 - 0.1 - rules.player.radius);
    expect(replay.vx).toBe(0);
    player.slotCooldownTicks[0] = 10;
    expect(replayPendingInputs(player, [input(2, { castSlots: [0], slotPresses: [0], slotReleases: [0] })], rules).x).toBe(0);
  });

  it('applies instant dashes before physics and gates repeated casts by cooldown', () => {
    const rules = createDefaultRuleset();
    rules.obstacles = [];
    const ability = rules.abilities.find((entry) => entry.id === rules.loadout.abilityIds[0])!;
    ability.charge = undefined;
    ability.targeting = 'free-aim';
    ability.effects = [{ kind: 'selfDash', distance: 2 }];
    const anchors: number[] = [];
    const player = playerAt('local', 0, 0);
    const replay = replayPendingInputs(player, [input(2, { moveX: 1, castSlots: [0] }), input(3, { moveX: 1, castSlots: [0] })], rules,
      (position, velocity) => { anchors.push(position.x); return { x: position.x + velocity.x / rules.tickRate, y: position.y, vx: velocity.x, vy: velocity.y }; });
    expect(anchors[0]).toBeCloseTo(2);
    expect(replay.x).toBeCloseTo(2 + rules.player.speed * 2 / rules.tickRate);
  });

  it('discards future predictions when an observed death resets the life state', () => {
    const smoother = new SnapshotSmoother(createDefaultRuleset(), 'local');
    try {
      smoother.pushAuthoritative(snapshotAt(10, [playerAt('local', 0, 0)]), 0);
      smoother.render(0, [input(2), input(3)]);
      smoother.pushAuthoritative(snapshotAt(11, [{ ...playerAt('local', 0, 0), alive: false, lastInputSequence: 2 }]), 33);
      smoother.pushAuthoritative(snapshotAt(12, [{ ...playerAt('local', 0, 0), alive: true, respawnTick: 0, lastInputSequence: 3 }]), 66);
      expect(smoother.predictionAtTick(12)).toBeUndefined();
    } finally { smoother.destroy(); }
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
    expect(replay.x).toBeCloseTo(2.2 + rules.player.speed / rules.tickRate * (ability.charge!.moveSpeedMultiplier + 1));
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

  it('uses velocity tangents over the actual snapshot gap and keeps relic/body views aligned', async () => {
    const smoother = new SnapshotSmoother(createDefaultRuleset());
    await smoother.ready;
    try {
      smoother.pushAuthoritative(ballSnapshot(10, 0, 0), 1);
      smoother.pushAuthoritative(ballSnapshot(14, 1, 1), 100);
      const rendered = smoother.render(100)!; // Tick 12, halfway across a four-tick gap.
      const expected = 0.5 - 0.125 * 4 / 30;
      expect(rendered.physicsBodies[0].x).toBeCloseTo(expected);
      expect(rendered.objectives[0].x).toBe(rendered.physicsBodies[0].x);
      expect(smoother.render(110)!.physicsBodies[0].x).toBeGreaterThan(expected);
      // A long stall holds the last anchor instead of driving a dynamic ball through walls.
      expect(smoother.render(1000)!.physicsBodies[0].x).toBe(1);
    } finally { smoother.destroy(); }
  });

  it('snaps goal resets and prunes despawned body history before an ID is seen again', async () => {
    const smoother = new SnapshotSmoother(createDefaultRuleset());
    await smoother.ready;
    try {
      smoother.pushAuthoritative(ballSnapshot(10, 8, 1), 1);
      const reset = ballSnapshot(11, 0, 0);
      reset.objectives[0].scoreCooldownTicks = 30;
      smoother.pushAuthoritative(reset, 33);
      expect(smoother.render(33)!.physicsBodies[0].x).toBe(0);
      expect(smoother.render(33)!.objectives[0].x).toBe(0);
      smoother.pushAuthoritative(snapshotAt(12, []), 66);
      smoother.pushAuthoritative(ballSnapshot(13, -4, 0), 99);
      expect(smoother.render(99)!.physicsBodies[0].x).toBe(-4);
      smoother.pushAuthoritative(ballSnapshot(12, 8, 0), 100); // Out of order.
      expect(smoother.render(100)!.physicsBodies[0].x).toBe(-4);
    } finally { smoother.destroy(); }
  });

  it('recognizes a goal reset across lost snapshots even when its cooldown is lower', async () => {
    const smoother = new SnapshotSmoother(createDefaultRuleset());
    await smoother.ready;
    try {
      const before = ballSnapshot(10, 8, 0);
      before.objectives[0].scoreCooldownTicks = 30;
      smoother.pushAuthoritative(before, 1);
      const after = ballSnapshot(60, 0, 0);
      after.objectives[0].scoreCooldownTicks = 20;
      smoother.pushAuthoritative(after, 100);
      const rendered = smoother.render(100)!;
      expect(rendered.physicsBodies[0].x).toBe(0);
      expect(rendered.objectives[0].x).toBe(0);
    } finally { smoother.destroy(); }
  });

  it('keeps a non-resetting relic on the delayed timeline when it scores', async () => {
    const rules = createDefaultRuleset();
    const relic = rules.objectives[0];
    if (relic.kind !== 'relicPush') throw new Error('Expected a relic objective');
    relic.resetOnScore = false;
    const smoother = new SnapshotSmoother(rules);
    await smoother.ready;
    try {
      smoother.pushAuthoritative(ballSnapshot(10, 8, 0), 1);
      const scored = ballSnapshot(14, 9, 0);
      scored.objectives[0].scoreCooldownTicks = 30;
      smoother.pushAuthoritative(scored, 100);
      const rendered = smoother.render(100)!;
      expect(rendered.physicsBodies[0].x).toBeCloseTo(8.5);
      expect(rendered.objectives[0].x).toBe(rendered.physicsBodies[0].x);
    } finally { smoother.destroy(); }
  });

  it('preserves interpolation while a goal cooldown counts down normally', async () => {
    const smoother = new SnapshotSmoother(createDefaultRuleset());
    await smoother.ready;
    try {
      const older = ballSnapshot(10, 8, 0);
      older.objectives[0].scoreCooldownTicks = 30;
      const newer = ballSnapshot(14, 9, 0);
      newer.objectives[0].scoreCooldownTicks = 26;
      smoother.pushAuthoritative(older, 1);
      smoother.pushAuthoritative(newer, 100);
      expect(smoother.render(100)!.physicsBodies[0].x).toBeCloseTo(8.5);
      const replacement = ballSnapshot(15, 9, 0);
      replacement.objectives[0].bodyId = 'replacement';
      replacement.physicsBodies[0].bodyId = 'replacement';
      smoother.pushAuthoritative(replacement, 133);
      const replaced = smoother.render(133)!;
      expect(replaced.physicsBodies[0].x).toBe(9);
      expect(replaced.objectives[0].x).toBe(9);
    } finally { smoother.destroy(); }
  });

  it('rejects Hermite overshoot into static walls and smooths bodyless relic snapshots', async () => {
    const rules = createDefaultRuleset();
    rules.obstacles = [];
    const smoother = new SnapshotSmoother(rules);
    await smoother.ready;
    try {
      const edge = rules.arena.width / 2 - 0.5 - 0.01;
      const older = ballSnapshot(10, edge, 100);
      const newer = ballSnapshot(14, edge, -100);
      older.objectives[0].bodyId = undefined;
      newer.objectives[0].bodyId = undefined;
      smoother.pushAuthoritative(older, 1);
      smoother.pushAuthoritative(newer, 100);
      const rendered = smoother.render(100)!;
      expect(rendered.physicsBodies[0].x).toBe(edge);
      expect(rendered.objectives[0].x).toBe(edge);
    } finally { smoother.destroy(); }
  });
});

function ballSnapshot(tick: number, x: number, vx: number): EngineSnapshot {
  const snapshot = snapshotAt(tick, []);
  snapshot.physicsBodies = [{ bodyId: 'ball', x, y: 0, vx, vy: 0, radius: 0.5, color: '#ffffff', remainingTicks: 100 }];
  snapshot.objectives = [{ objectiveId: 'center-relic', name: 'Relic', kind: 'relicPush', bodyId: 'ball', x, y: 0, vx, vy: 0,
    radius: 0.5, color: '#ffffff', scoreCooldownTicks: 0, zones: [] }];
  return snapshot;
}

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
