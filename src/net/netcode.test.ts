import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { EngineSnapshot, PlayerInput } from '../engine/protocol';
import { fromNetworkSnapshot, toNetworkSnapshot } from './compactSnapshot';
import { PendingInputQueue } from './pendingInputs';
import { replayPendingInputs, SnapshotSmoother } from './snapshotSmoothing';

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
    expect(replay.vx).toBeCloseTo(ruleset.player.speed);
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
  });

  it('interpolates remote players and extrapolates briefly when the stream stalls', () => {
    const ruleset = createDefaultRuleset();
    const smoother = new SnapshotSmoother(ruleset, 'local');
    smoother.pushAuthoritative(snapshotAt(1, [playerAt('remote', 0, 0, 3)]), 0);
    smoother.pushAuthoritative(snapshotAt(2, [playerAt('remote', 1, 0, 3)]), 33);

    const rendered = smoother.render(233);
    const remote = rendered?.players.find((player) => player.playerId === 'remote');

    expect(remote?.x).toBeGreaterThan(1.25);
    expect(smoother.stats().remoteExtrapolationEvents).toBe(1);
    expect(smoother.stats().remoteExtrapolationSeconds).toBeGreaterThan(0);
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
  overrides: Partial<Pick<PlayerInput, 'moveX' | 'moveY' | 'castSlots' | 'slotPresses' | 'slotReleases'>> = {},
): PlayerInput {
  return {
    sequence,
    moveX: overrides.moveX ?? 0,
    moveY: overrides.moveY ?? 0,
    aimDx: 1,
    aimDy: 0,
    castSlots: overrides.castSlots ?? [],
    slotPresses: overrides.slotPresses ?? [],
    slotReleases: overrides.slotReleases ?? [],
    sampledAtMs: sequence * 10,
  };
}
