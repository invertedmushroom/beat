import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { EngineSnapshot, PlayerSnapshot } from '../engine/protocol';
import { SnapshotDecoder, SnapshotEncoder } from '../net/snapshotCodec';
import { MAX_REPLAY_FILE_BYTES, parseReplay, ReplayRecorder, serializeReplay } from './archive';
import { ReplayPlayer } from './player';

const rules = createDefaultRuleset();
const metadata = { version: 1 as const, ruleset: rules, source: 'client' as const, recordedAt: 123, localPlayerId: 'p1' };
const diagnostics = { pendingInputs: 3, predictionError: 0.12, snapCorrections: 2 };

describe('bounded replay archives', () => {
  it.each([1, 2] as const)('imports archives containing codec v%s snapshots', (version) => {
    const encoder = new SnapshotEncoder(rules.arena, 60, version);
    const frames = [1, 2].map((tick) => {
      const packets = encoder.encode(snapshot(tick));
      encoder.acknowledge(tick);
      return { tick, packets, keyframe: tick === 1 };
    });
    const player = new ReplayPlayer(parseReplay(serializeReplay({ metadata, frames, bytes: 0, durationMs: 1000 / rules.tickRate }).buffer));
    player.step(1);
    expect(player.frame(0).snapshot.players[0].jumpHeld).toBe(true);
    expect(player.frame(0).snapshot.tick).toBe(2);
  });
  it('round-trips rules, quantized snapshots, and client diagnostics on an independent baseline chain', () => {
    const recorder = new ReplayRecorder(metadata);
    for (let tick = 1; tick <= 65; tick++) recorder.record(snapshot(tick), diagnostics);
    const clip = parseReplay(serializeReplay(recorder.clip()!).buffer);
    expect(clip.metadata).toEqual(metadata);
    expect(clip.frames).toHaveLength(65);
    expect(clip.frames[1].keyframe).toBe(false);
    expect(clip.frames[64].diagnostics).toEqual(diagnostics);
    const decoder = new SnapshotDecoder(rules.arena);
    let latest: EngineSnapshot | undefined;
    for (const frame of clip.frames) for (const packet of frame.packets) latest = decoder.receive(packet.buffer as ArrayBuffer).snapshot ?? latest;
    expect(latest?.tick).toBe(65);
    expect(latest?.players[0].x).toBeCloseTo(6.5, 2);
    expect(latest?.players[0].jumpHeld).toBe(true);
  });

  it('evicts complete checkpoint groups to keep both duration and encoded bytes bounded', () => {
    const timed = new ReplayRecorder(metadata, { maxBytes: 1_000_000, maxDurationMs: 2_000 });
    const sized = new ReplayRecorder(metadata, { maxBytes: 8_000, maxDurationMs: 30_000 });
    for (let tick = 1; tick <= 200; tick++) {
      timed.record(snapshot(tick)); sized.record(snapshot(tick));
    }
    for (const [recorder, maxBytes, duration] of [[timed, 1_000_000, 2_000], [sized, 8_000, 30_000]] as const) {
      const clip = recorder.clip()!;
      expect(clip.frames[0].tick).toBeGreaterThan(1);
      expect(clip.frames[0].keyframe).toBe(true);
      expect(clip.bytes).toBeLessThanOrEqual(maxBytes);
      expect(clip.durationMs).toBeLessThanOrEqual(duration);
      const imported = parseReplay(serializeReplay(clip).buffer);
      const player = new ReplayPlayer(imported);
      player.seek(imported.durationMs);
      expect(player.frame(0).snapshot.tick).toBe(200);
      player.seek(0);
      expect(player.frame(1).snapshot.tick).toBe(clip.frames[0].tick);
    }
  });

  it('caps recording rate at 30Hz, ignores duplicates, and owns its rules and packets', () => {
    const custom = structuredClone(metadata);
    custom.ruleset.tickRate = 120;
    const recorder = new ReplayRecorder(custom);
    custom.ruleset.name = 'mutated after construction';
    const initial = snapshot(1);
    recorder.record(initial);
    initial.players[0].x = 99;
    const first = recorder.clip()!.frames[0].packets[0].slice();
    for (let tick = 1; tick <= 120; tick++) recorder.record(snapshot(tick));
    const clip = recorder.clip()!;
    expect(clip.frames).toHaveLength(30);
    expect(clip.metadata.ruleset.name).toBe(rules.name);
    expect(clip.frames[0].packets[0]).toEqual(first);
    expect(parseReplay(serializeReplay(clip).buffer).frames).toHaveLength(30);
  });

  it('rejects invalid limits, changed rules, and a snapshot exceeding its budget', () => {
    expect(() => new ReplayRecorder(metadata, { maxBytes: 0, maxDurationMs: 1 })).toThrow();
    const recorder = new ReplayRecorder(metadata, { maxBytes: 24, maxDurationMs: 1_000 });
    expect(() => recorder.record(snapshot(1))).toThrow(/budget/);
    expect(recorder.clip()).toBeUndefined();
    expect(() => new ReplayRecorder(metadata).record({ ...snapshot(1), rulesetId: 'other' })).toThrow(/ruleset/);
  });

  it('rejects unsupported, truncated, oversized, corrupt, and incomplete archives', () => {
    const bytes = encodedClip();
    const badMagic = bytes.slice(); badMagic[0] ^= 1;
    const corrupt = bytes.slice(); corrupt[corrupt.length - 1] ^= 1;
    const offset = 12 + new DataView(bytes.buffer).getUint32(8, true);
    const badFlags = bytes.slice(); badFlags[offset] = 4;
    const badDiagnostics = bytes.slice(); new DataView(badDiagnostics.buffer).setFloat64(offset + 9, NaN, true);
    for (const invalid of [badMagic, corrupt, badFlags, badDiagnostics, bytes.slice(0, -1), bytes.slice(0, offset), bytes.slice(0, 6)]) {
      expect(() => parseReplay(invalid.buffer)).toThrow();
    }
    expect(() => parseReplay(new ArrayBuffer(MAX_REPLAY_FILE_BYTES + 1))).toThrow(/large/);
  });

  it('rejects snapshots with unsafe drawing geometry before exposing the clip', () => {
    const recorder = new ReplayRecorder(metadata);
    const state = snapshot(1);
    state.effects = [{ effectId: 'bad', kind: 'impact', x: 0, y: 0, radius: -1, ageTicks: 0, lifetimeTicks: 10, color: '#fff' }];
    recorder.record(state);
    expect(() => parseReplay(serializeReplay(recorder.clip()!).buffer)).toThrow(/radius/);
  });

  it('rejects a valid transport delta that crosses an archive checkpoint', () => {
    const encoder = new SnapshotEncoder(rules.arena, 2);
    const frames = [1, 2, 3, 4].map((tick) => {
      // Tick 3 is a full checkpoint. Tick 4 incorrectly refers back to tick 2.
      if (tick > 1) encoder.acknowledge(tick === 4 ? 2 : tick - 1);
      const packets = encoder.encode(snapshot(tick));
      return { tick, packets, keyframe: new DataView(packets[0].buffer).getUint32(8) === 0xffffffff };
    });
    expect(frames[2].keyframe).toBe(true);
    expect(() => parseReplay(serializeReplay({ metadata, frames, bytes: 0, durationMs: 100 }).buffer)).toThrow(/baseline/);
  });
});

describe('visual replay playback', () => {
  it.each([30, 60, 120])('steps between recorded samples at %sHz, including gaps and interpolated positions', (tickRate) => {
    const custom = structuredClone(metadata);
    custom.ruleset.tickRate = tickRate;
    const spacing = Math.ceil(tickRate / 30);
    const ticks = [1, 1 + spacing, 1 + spacing * 4];
    const recorder = new ReplayRecorder(custom);
    for (const tick of ticks) recorder.record(snapshot(tick));
    const player = new ReplayPlayer(recorder.clip()!);
    player.step(-1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[0]);
    player.setPlaying(true);
    player.step(1);
    expect(player.frame(0).playing).toBe(false);
    expect(player.frame(0).snapshot.tick).toBe(ticks[1]);
    player.step(1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[2]);
    player.step(1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[2]);
    player.step(-1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[1]);
    player.seek((ticks[1] - 1 + spacing * 0.5) * 1000 / tickRate);
    player.step(-1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[1]);
    player.seek((ticks[1] - 1 + spacing * 0.5) * 1000 / tickRate);
    player.step(1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[2]);
    player.step(-1); player.step(-1);
    expect(player.frame(0).snapshot.tick).toBe(ticks[0]);
  });

  it('interpolates moving objectives by identity and keeps scoring and creation discrete', () => {
    const recorder = new ReplayRecorder(metadata);
    const before = snapshot(1), after = snapshot(2);
    const objective: EngineSnapshot['objectives'][number] = { objectiveId: 'ball', name: 'Ball', kind: 'relicPush', bodyId: 'ball-body',
      x: 0, y: 0, vx: 3, vy: 0, radius: 0.5, color: '#fff', scoreCooldownTicks: 0, zones: [] };
    before.objectives = [objective, { ...objective, objectiveId: 'removed', x: -5 }];
    after.objectives = [{ ...objective, objectiveId: 'new', x: 12 }, { ...objective, x: 4, y: 2, lastScoredTeamId: 'players' }];
    recorder.record(before); recorder.record(after);
    const player = new ReplayPlayer(recorder.clip()!);
    player.seek(500 / rules.tickRate);
    const objectives = player.frame(0).snapshot.objectives;
    expect(objectives.map((entity) => entity.objectiveId)).toEqual(['ball', 'removed']);
    expect(objectives[0].x).toBeCloseTo(2, 2);
    expect(objectives[0].y).toBeCloseTo(1, 2);
    expect(objectives[0].lastScoredTeamId).toBeUndefined();
    expect(objectives[1].x).toBeCloseTo(-5, 2);
    player.step(1);
    expect(player.frame(0).snapshot.objectives[1].lastScoredTeamId).toBe('players');
  });

  it.each([[170, -170, 180], [0, 180, 90], [0, 90, 45], [15, 15, 15]])(
    'interpolates facing and aim along the shortest arc from %s to %s degrees', (from, to, midpoint) => {
      const recorder = new ReplayRecorder(metadata);
      const before = snapshot(1), after = snapshot(2);
      for (const [state, degrees] of [[before, from], [after, to]] as const) {
        const radians = degrees * Math.PI / 180;
        Object.assign(state.players[0], { facingDx: Math.cos(radians) * 2, facingDy: Math.sin(radians) * 2,
          aimDx: Math.cos(radians) * 3, aimDy: Math.sin(radians) * 3 });
      }
      recorder.record(before); recorder.record(after);
      const player = new ReplayPlayer(recorder.clip()!);
      player.seek(500 / rules.tickRate);
      const rendered = player.frame(0).snapshot.players[0];
      const expected = midpoint * Math.PI / 180;
      expect(rendered.facingDx).toBeCloseTo(Math.cos(expected), 6);
      expect(rendered.facingDy).toBeCloseTo(Math.sin(expected), 6);
      expect(rendered.aimDx).toBeCloseTo(Math.cos(expected), 6);
      expect(rendered.aimDy).toBeCloseTo(Math.sin(expected), 6);
      // Seeking must not mutate a decoded baseline or change its recorded direction.
      player.seek(0);
      expect(player.frame(0).snapshot.players[0].facingDx).toBe(before.players[0].facingDx);
    });

  it('seeks across checkpoints in either direction and interpolates only matching entities', () => {
    const recorder = new ReplayRecorder(metadata);
    for (let tick = 1; tick <= 150; tick++) recorder.record(snapshot(tick), diagnostics);
    const player = new ReplayPlayer(parseReplay(serializeReplay(recorder.clip()!).buffer));
    for (const tick of [1, 135, 4, 80, 80.5, 2, 150, 149, 60, 61]) {
      player.seek((tick - 1) / rules.tickRate * 1000);
      const view = player.frame(0);
      expect(view.snapshot.players[0].x).toBeCloseTo(tick / 10, 2);
      expect(view.diagnostics).toEqual(diagnostics);
      expect(view.playing).toBe(false);
    }
  });

  it('keeps death, respawn, and entity creation discrete while seeking', () => {
    const recorder = new ReplayRecorder(metadata);
    recorder.record(snapshot(1));
    const dead = snapshot(2); dead.players[0].alive = false; dead.players[0].x = 10;
    dead.players[0].facingDx = -1; dead.players[0].aimDx = -1;
    dead.players.push({ ...dead.players[0], playerId: 'new' });
    recorder.record(dead);
    const player = new ReplayPlayer(recorder.clip()!);
    player.seek(500 / rules.tickRate);
    expect(player.frame(0).snapshot.players).toHaveLength(1);
    expect(player.frame(0).snapshot.players[0].x).toBeCloseTo(0.1, 2);
    expect(player.frame(0).snapshot.players[0].alive).toBe(true);
    expect(player.frame(0).snapshot.players[0].facingDx).toBe(1);
    expect(player.frame(0).snapshot.players[0].aimDx).toBe(1);
    player.seek(1_000 / rules.tickRate);
    expect(player.frame(0).snapshot.players).toHaveLength(2);
    expect(player.frame(0).snapshot.players[0].alive).toBe(false);
  });

  it('pauses, changes speed, clamps seeks, ends playback, and restarts', () => {
    const recorder = new ReplayRecorder(metadata);
    for (let tick = 1; tick <= 61; tick++) recorder.record(snapshot(tick));
    const player = new ReplayPlayer(recorder.clip()!);
    expect(player.frame(0).positionMs).toBe(0);
    player.setPlaying(true); player.frame(100);
    expect(player.frame(300).positionMs).toBe(200);
    player.setPlaying(false);
    expect(player.frame(500).positionMs).toBe(200);
    player.setSpeed(2); player.setPlaying(true); player.frame(500);
    expect(player.frame(600).positionMs).toBe(400);
    player.seek(100_000);
    expect(player.frame(700).playing).toBe(false);
    player.setPlaying(true);
    expect(player.frame(800).positionMs).toBe(0);
    player.seek(-1); player.seek(NaN);
    expect(player.frame(800).positionMs).toBe(0);
    player.setSpeed(17);
    expect(player.frame(800).speed).toBe(2);
  });

  it('keeps a changed respawn identity discrete and handles zero direction vectors', () => {
    const recorder = new ReplayRecorder(metadata);
    const before = snapshot(1), after = snapshot(2);
    Object.assign(after.players[0], { respawnTick: 2, x: 10, facingDx: -1, aimDx: -1 });
    before.players.push({ ...before.players[0], playerId: 'zero', facingDx: 0, aimDx: 0 });
    after.players.push({ ...before.players[1], facingDy: 2 });
    recorder.record(before); recorder.record(after);
    const player = new ReplayPlayer(recorder.clip()!);
    player.seek(500 / rules.tickRate);
    const players = player.frame(0).snapshot.players;
    expect(players[0].x).toBeCloseTo(0.1, 2);
    expect(players[0].facingDx).toBe(1);
    expect(players[1].facingDx).toBe(0);
    expect(players[1].facingDy).toBe(1);
    expect(players[1].aimDx).toBe(0);
    expect(players[1].aimDy).toBe(0);
  });
});

function encodedClip(): Uint8Array<ArrayBuffer> {
  const recorder = new ReplayRecorder(metadata);
  recorder.record(snapshot(1), diagnostics);
  recorder.record(snapshot(2), diagnostics);
  return serializeReplay(recorder.clip()!);
}
function snapshot(tick: number): EngineSnapshot {
  const player: PlayerSnapshot = { playerId: 'p1', displayName: 'Player', x: tick / 10, y: 0, vx: 3, vy: 0, hue: 120, hp: 100, maxHp: 100,
    alive: true, respawnTick: 0, slotCooldownTicks: [0, 0, 0, 0], lastUsedSlot: 0, aimDx: 1, aimDy: 0, facingDx: 1, facingDy: 0,
    role: 'player', team: 'players', statuses: [], resources: [], lastInputSequence: tick, jumpHeld: true };
  return { tick, nowMs: tick * 1000 / rules.tickRate, rulesetId: rules.id,
    match: { elapsedTicks: tick, remainingTicks: 100, durationTicks: 100, scoreLimit: 1, finished: false, teams: [] },
    players: [player], objectives: [], projectiles: [], physicsBodies: [], constraints: [], effects: [], combatTexts: [], mechanicTraces: [], aiTraces: [] };
}
