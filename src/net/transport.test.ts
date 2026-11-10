import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { EngineSnapshot, PlayerSnapshot } from '../engine/protocol';
import { AffineClockSync, INPUT_ARRIVAL_LEAD_MS } from './clockSync';
import { CollisionPrediction } from './collisionPrediction';
import { prepareSnapshot, SnapshotDecoder, SnapshotEncoder, SNAPSHOT_PACKET_BYTES, quantizePosition, dequantizePosition } from './snapshotCodec';
import { decodeSnapshotPatch, SnapshotPatchWriter } from './snapshotBinary';
import { SnapshotSmoother } from './snapshotSmoothing';
import { decodeClientMessage, decodeHostMessage } from './messages';

const rules = createDefaultRuleset();
const arena = rules.arena;

describe('affine clock and input phase', () => {
  it('fits drift with epoch-sized host timestamps, excluding processing time and queued RTT outliers', () => {
    const clock = new AffineClockSync();
    const rate = 1.0002;
    const server = (time: number) => 1_800_000_000_000 + rate * time;
    for (let i = 0; i < 16; i++) {
      const t1 = i * 1_000;
      clock.observe(t1, server(t1 + 20), server(t1 + 30), t1 + 50);
    }
    // A queued control response must not bias the fit.
    clock.observe(16_000, server(16_020), server(16_030), 16_500);
    expect(clock.stats().rate).toBeCloseTo(rate, 6);
    expect(clock.toServer(17_000)).toBeCloseTo(server(17_000), 2);
    expect(clock.stats().rttMs).toBeCloseTo(40, 1);
  });

  it('paces estimated arrival 20ms before an actual worker deadline', () => {
    const clock = new AffineClockSync();
    const offset = 50_000;
    const intervalMs = 1_000 / 30;
    const nextTickAtMs = offset + 1_100;
    clock.observe(1_000, offset + 1_020, offset + 1_025, 1_045, { tick: 30, nextTickAtMs, intervalMs });
    for (const now of [1_046, 1_060, 1_080, 1_111]) {
      const delay = clock.inputDelayMs(now);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(intervalMs);
      const arrival = clock.toServer(now + delay) + 20;
      const tickTime = nextTickAtMs + Math.round((arrival + INPUT_ARRIVAL_LEAD_MS - nextTickAtMs) / intervalMs) * intervalMs;
      expect(tickTime - arrival).toBeCloseTo(20, 6);
    }
    expect(clock.inputDelayMs(10_000)).toBe(0);
    clock.reset();
    expect(clock.inputDelayMs(1_100)).toBe(0);
  });

  it('rejects impossible samples and clears old drift after suspension', () => {
    const clock = new AffineClockSync();
    expect(clock.observe(2, 3, 2, 4)).toBe(false);
    expect(clock.observe(0, 5, 10, 1)).toBe(false);
    expect(clock.observe(0, 0, 0, Infinity)).toBe(false);
    clock.observe(0, 100, 100, 20);
    clock.observe(30_000, 60_000, 60_000, 30_020);
    expect(clock.stats().samples).toBe(1);
  });
});

describe('quantized acknowledged snapshot transport', () => {
  it('bounds arena quantization error to half a u16 cell', () => {
    for (let i = 0; i <= 1_000; i++) {
      const x = (i / 1_000 - 0.5) * arena.width;
      expect(Math.abs(x - dequantizePosition(quantizePosition(x, arena.width), arena.width))).toBeLessThanOrEqual(arena.width / 65535 / 2 + 1e-9);
    }
  });

  it('uses the last ACK rather than the last send across losses, without mutating baselines', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const receiver = new SnapshotDecoder(arena);
    const first = receive(receiver, sender.encode(snapshot(1)));
    sender.acknowledge(first!.tick);
    sender.encode(snapshot(2)); // Drop the entire frame.
    sender.acknowledge(999); // Unsent ACK cannot become a baseline.
    const third = sender.encode(snapshot(3));
    expect(new DataView(third[0].buffer).getUint32(8)).toBe(1);
    expect(third).toHaveLength(1);
    expect(third[0].byteLength).toBeLessThan(600);
    const decoded = receive(receiver, third)!;
    expect(decoded.tick).toBe(3);
    expect(decoded.players[0].x).toBeCloseTo(0.3, 3);
    expect(first!.players[0].x).toBeCloseTo(0.1, 3);
    expect(receive(receiver, sender.encode(snapshot(2)))).toBeUndefined();
  });

  it('keeps busy frames below the packet budget and reassembles reordered fragments atomically', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const receiver = new SnapshotDecoder(arena);
    const busy = snapshot(1);
    busy.projectiles = Array.from({ length: 250 }, (_, i) => ({ projectileId: `projectile_${i}`, ownerId: 'p0', abilityId: 'shot', x: 1, y: 2, radius: 0.2, color: '#ff0000' }));
    const packets = sender.encode(busy);
    expect(packets.length).toBeGreaterThan(1);
    expect(packets.every((packet) => packet.byteLength <= SNAPSHOT_PACKET_BYTES)).toBe(true);
    expect(receive(receiver, packets.slice(1))).toBeUndefined();
    const decoded = receive(receiver, [packets[0]]);
    expect(decoded?.projectiles).toHaveLength(250);
    expect(decoded?.players[0].displayName).toBe('Player é 0');
  });

  it('never replaces an acknowledged baseline with changed state at the same paused tick', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const receiver = new SnapshotDecoder(arena);
    receive(receiver, sender.encode(snapshot(1)));
    sender.acknowledge(1);
    const paused = snapshot(1);
    paused.players[0].hp = 42;
    sender.encode(paused);
    const next = snapshot(2);
    next.players[0].hp = 42;
    expect(receive(receiver, sender.encode(next))?.players[0].hp).toBe(42);
  });

  it('encodes a head despawn without rewriting the surviving entity tail', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const receiver = new SnapshotDecoder(arena);
    const first = snapshot(1);
    first.projectiles = Array.from({ length: 100 }, (_, i) => ({ projectileId: `shot_${i}`, ownerId: 'p0', abilityId: 'shot', x: 1, y: 2, radius: 0.2, color: '#ff0000' }));
    receive(receiver, sender.encode(first));
    sender.acknowledge(1);
    const next = structuredClone(first);
    next.tick = 2;
    next.projectiles.shift();
    const packets = sender.encode(next);
    expect(packets.reduce((sum, packet) => sum + packet.byteLength, 0)).toBeLessThan(128);
    expect(receive(receiver, packets)?.projectiles.map((entry) => entry.projectileId)).toEqual(next.projectiles.map((entry) => entry.projectileId));
  });

  it('requests a keyframe after a baseline miss and recovers without acknowledging partial frames', () => {
    const sender = new SnapshotEncoder(arena, 60);
    sender.encode(snapshot(1));
    sender.acknowledge(1);
    const receiver = new SnapshotDecoder(arena);
    const delta = sender.encode(snapshot(2));
    expect(receiver.receive(delta[0].buffer as ArrayBuffer)).toEqual({ needsKeyframe: true });
    sender.acknowledge(-1);
    expect(receive(receiver, sender.encode(snapshot(3)))?.tick).toBe(3);
  });

  it('preserves removals, optional fields, and nested mechanic state through deltas', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const receiver = new SnapshotDecoder(arena);
    const first = snapshot(1);
    first.players[0].status = { slowMultiplier: 0.5, slowTicks: 10, slowColor: '#fff' };
    first.players[0].resources = [{ id: 'mana', name: 'Mana', color: '#fff', value: 2, max: 10 }];
    receive(receiver, sender.encode(first));
    sender.acknowledge(1);
    const next = structuredClone(first);
    next.tick = 2;
    next.players.pop();
    delete next.players[0].status;
    next.players[0].resources[0].value = 3.75;
    const decoded = receive(receiver, sender.encode(next))!;
    expect(decoded.players).toHaveLength(7);
    expect(decoded.players[0].status).toBeUndefined();
    expect(decoded.players[0].resources[0].value).toBe(3.75);
  });

  it('rejects truncated, oversized, corrupted and structurally invalid snapshots', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const receiver = new SnapshotDecoder(arena);
    const packets = sender.encode(snapshot(1));
    expect(receiver.receive(new ArrayBuffer(2))).toEqual({});
    expect(receiver.receive(new ArrayBuffer(1_201))).toEqual({});
    const corrupted = packets.map((packet) => packet.slice());
    corrupted[0][24] ^= 255;
    expect(receive(receiver, corrupted)).toBeUndefined();
    const invalid = snapshot(2);
    invalid.players[0].statuses = null as never;
    expect(receive(receiver, sender.encode(invalid))).toBeUndefined();
    expect(receive(receiver, sender.encode(snapshot(3)))?.tick).toBe(3);
  });

  it('shares immutable preparation across peers without reusing emitted packet buffers', () => {
    const first = snapshot(1);
    const prepared = prepareSnapshot(first, arena);
    const a = new SnapshotEncoder(arena, 60), b = new SnapshotEncoder(arena, 60);
    const oldPackets = a.encodePrepared(prepared)!.packets;
    const savedBytes = oldPackets[0].slice();
    expect(b.encodePrepared(prepared)!.packets).toEqual(oldPackets);
    expect(prepared.value).toBe(prepared.value);
    a.acknowledge(1);
    a.encodePrepared(prepareSnapshot(snapshot(2), arena));
    expect(oldPackets[0]).toEqual(savedBytes);
    expect(receive(new SnapshotDecoder(arena), oldPackets)?.tick).toBe(1);
  });

  it.each([1, 2] as const)('round-trips entity changes with negotiated codec version %s', (version) => {
    const sender = new SnapshotEncoder(arena, 60, version);
    const receiver = new SnapshotDecoder(arena);
    let current = snapshot(1);
    current.projectiles = Array.from({ length: 25 }, (_, i) => ({ projectileId: `shot_${i}`, ownerId: 'p0', abilityId: 'shot', x: i / 10, y: 2, radius: 0.2, color: '#abc' }));
    for (let tick = 1; tick <= 35; tick++) {
      current = structuredClone(current);
      current.tick = tick;
      if (tick % 2 === 0) current.projectiles.reverse();
      if (tick % 3 === 0) current.projectiles.shift();
      if (tick % 5 === 0) current.projectiles.splice(1, 0, { projectileId: `new_${tick}`, ownerId: 'p1', abilityId: 'new', x: 3, y: 4, radius: 0.3, color: '#def' });
      const packets = sender.encode(current);
      expect(packets[0][2]).toBe(version);
      if (tick % 4 === 0) continue; // Later deltas must still match the older ACK.
      const decoded = receive(receiver, packets)!;
      expect(decoded.projectiles.map((entry) => entry.projectileId)).toEqual(current.projectiles.map((entry) => entry.projectileId));
      sender.acknowledge(tick);
    }
  });

  it('allows slow reliable keyframe assembly independently of newer incomplete datagrams', () => {
    const sender = new SnapshotEncoder(arena, 60);
    const busy = snapshot(1);
    busy.projectiles = Array.from({ length: 120 }, (_, i) => ({ projectileId: `shot_${i}`, ownerId: 'p0', abilityId: 'shot', x: 1, y: 2, radius: 0.2, color: '#abc' }));
    const packets = sender.encode(busy);
    const receiver = new SnapshotDecoder(arena);
    expect(receiver.receive(packets[0].buffer as ArrayBuffer, 0, true)).toEqual({});
    for (let tick = 2; tick <= 8; tick++) {
      busy.tick = tick;
      receiver.receive(sender.encode(busy)[0].buffer as ArrayBuffer, 2_000);
    }
    let decoded: EngineSnapshot | undefined;
    for (const packet of packets.slice(1)) decoded = receiver.receive(packet.buffer as ArrayBuffer, 2_100, true).snapshot ?? decoded;
    expect(decoded?.projectiles).toHaveLength(120);
    expect(decoded?.tick).toBe(1);
  });

  it.each([Infinity, 10])('pins a referenced baseline through a long ACK delay with keyframe interval %s', (interval) => {
    const sender = new SnapshotEncoder(arena, interval);
    const receiver = new SnapshotDecoder(arena);
    receive(receiver, sender.encode(snapshot(1)));
    sender.acknowledge(1);
    for (let tick = 2; tick < 90; tick++) expect(receive(receiver, sender.encode(snapshot(tick)))?.tick).toBe(tick);
    sender.acknowledge(89);
    expect(receive(receiver, sender.encode(snapshot(90)))?.tick).toBe(90);
  });
});

it('does not let phase notices refresh NTP sample age or regress the worker timeline', () => {
  const clock = new AffineClockSync();
  clock.observe(1_000, 51_020, 51_025, 1_045, { tick: 30, nextTickAtMs: 51_100, intervalMs: 1_000 / 30 });
  expect(clock.updateTiming({ tick: 31, nextTickAtMs: 51_140, intervalMs: 1_000 / 30 })).toBe(true);
  expect(clock.updateTiming({ tick: 29, nextTickAtMs: 51_200, intervalMs: 1_000 / 30 })).toBe(false);
  expect(clock.stats().samples).toBe(1);
  expect(clock.inputDelayMs(7_000)).toBe(0);
  expect(decodeHostMessage('{"type":"timing","timing":{"tick":1,"nextTickAtMs":20,"intervalMs":0}}')).toBeUndefined();
});

it('bounds and validates the keyed entity patch decoder and reuses its float buffer', () => {
  expect(() => decodeSnapshotPatch(Uint8Array.of(13, 1, 1, 2, 1, 0), [])).toThrow();
  expect(() => decodeSnapshotPatch(Uint8Array.of(13, 2, 2, 1, 1, 1, 1, 0), [{ id: 'a' }])).toThrow();
  expect(() => decodeSnapshotPatch(Uint8Array.of(13, 1, 1, 0, 1, 0), [])).toThrow();
  expect(() => decodeSnapshotPatch(Uint8Array.of(13, 0, 0, 0), [], 1)).toThrow();
  const writer = new SnapshotPatchWriter();
  for (const value of [1.125, -3.75, 1e100, 'unknown 🚀 field é']) {
    expect(decodeSnapshotPatch(writer.encode(value))).toBe(value);
  }
});

describe('collision constrained remote prediction', () => {
  it('blocks high-speed wall crossing, slides along obstacles and freezes after three ticks', async () => {
    const collisionRules = createDefaultRuleset();
    collisionRules.obstacles = [{ id: 'wall', x: 2, y: 0, halfWidth: 0.2, halfHeight: 4 }];
    const predictor = await CollisionPrediction.create(collisionRules);
    try {
      const moving = { ...player('remote'), x: 1, y: 0, vx: 40, vy: 3 };
      const predicted = predictor.predict(moving, 3 / collisionRules.tickRate);
      expect(predicted.x).toBeLessThanOrEqual(1.8 - collisionRules.player.radius + 0.02);
      expect(predicted.y).toBeGreaterThan(0);
      expect(predictor.predict(moving, 1)).toEqual(predicted);
      expect(predictor.predict(moving, 3 / collisionRules.tickRate)).toEqual(predicted);
    } finally { predictor.destroy(); }
  });

  it('uses collision prediction in the real smoother and discards reordered authoritative snapshots', async () => {
    const collisionRules = createDefaultRuleset();
    collisionRules.obstacles = [{ id: 'wall', x: 2, y: 0, halfWidth: 0.2, halfHeight: 4 }];
    const smoother = new SnapshotSmoother(collisionRules);
    await smoother.ready;
    try {
      const frame = snapshot(10);
      frame.players = [{ ...player('remote'), x: 1, vx: 40 }];
      smoother.pushAuthoritative(frame, 100);
      smoother.pushAuthoritative(snapshot(9), 110);
      const rendered = smoother.render(400)!;
      expect(rendered.tick).toBe(10);
      expect(rendered.players[0].x).toBeLessThan(1.8 - collisionRules.player.radius + 0.02);
    } finally { smoother.destroy(); }
  });
});

it('validates the new control messages before accepting clock or baseline state', () => {
  expect(decodeClientMessage('{"type":"snapshot-ack","tick":-1}')).toBeTruthy();
  expect(decodeClientMessage('{"type":"snapshot-ack","tick":1.5}')).toBeUndefined();
  expect(decodeHostMessage('{"type":"pong","sentAtMs":0,"receivedAtMs":10,"serverSentAtMs":9}')).toBeUndefined();
  expect(decodeHostMessage('{"type":"pong","sentAtMs":0,"receivedAtMs":10,"serverSentAtMs":11,"timing":{"tick":1,"nextTickAtMs":20,"intervalMs":0}}')).toBeUndefined();
});

function receive(receiver: SnapshotDecoder, packets: Uint8Array[]): EngineSnapshot | undefined {
  let snapshot: EngineSnapshot | undefined;
  for (const packet of packets.slice().reverse()) snapshot = receiver.receive(packet.buffer as ArrayBuffer).snapshot ?? snapshot;
  return snapshot;
}

function player(id: string): PlayerSnapshot {
  return { playerId: id, displayName: id, x: 0, y: 0, vx: 0, vy: 0, hue: 120, hp: 100, maxHp: 100, alive: true, respawnTick: 0,
    slotCooldownTicks: [0, 0, 0, 0], lastUsedSlot: 0, aimDx: 1, aimDy: 0, facingDx: 1, facingDy: 0, role: 'player', team: 'players', statuses: [], resources: [], lastInputSequence: 1 };
}

function snapshot(tick: number): EngineSnapshot {
  return { tick, nowMs: tick * 1000 / rules.tickRate, rulesetId: rules.id,
    match: { elapsedTicks: tick, remainingTicks: 1000 - tick, durationTicks: 1000, scoreLimit: 10, finished: false, teams: [] },
    players: Array.from({ length: 8 }, (_, i) => ({ ...player(`p${i}`), displayName: `Player é ${i}`, x: tick / 10, y: i, vx: 3, lastInputSequence: tick })),
    objectives: [], projectiles: [], physicsBodies: [], constraints: [], effects: [], combatTexts: [], mechanicTraces: [], aiTraces: [] };
}
