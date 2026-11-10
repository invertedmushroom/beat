import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { EngineSnapshot, EngineTickTiming, PlayerInput } from '../engine/protocol';
import type { EngineClient } from '../engine/EngineClient';
import type { RoomDirectory, RoomInfo, RoomSignal } from '../rooms/directory';
import { ClientSession, HostSession } from './webrtc';

vi.mock('./rtcConfig', () => ({ getRtcConfig: async () => ({ iceServers: [] }), describeRtcConfig: () => 'test ICE' }));

class Channel {
  readyState = 'open';
  bufferedAmount = 0;
  binaryType = 'blob';
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  readonly sent: Array<string | Uint8Array> = [];
  constructor(readonly label: string) {}
  send(data: string | Uint8Array): void { this.sent.push(data); }
  close(): void { this.readyState = 'closed'; }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('paces the actual input channel, preserves coalesced skill events, and cancels sends at teardown', async () => {
  vi.useFakeTimers();
  let now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval });
  const channels = new Map<string, Channel>();
  vi.stubGlobal('RTCPeerConnection', class {
    createDataChannel(label: string): Channel {
      const channel = new Channel(label);
      channels.set(label, channel);
      return channel;
    }
    async createOffer() { return { type: 'offer', sdp: 'test' }; }
    async setLocalDescription() {}
    close() {}
  });
  const room: RoomInfo = { roomId: 'room', hostPeerId: 'host', name: 'Room', rulesetId: 'rules', rulesetHash: 'hash', contentHash: 'hash', mapBundleId: 'map',
    playerCount: 1, maxPlayers: 4, transport: 'webrtc', status: 'open', createdAt: 0, lastHeartbeat: 0 };
  const directory: RoomDirectory = {
    advertiseRoom: () => {}, closeRoom: () => {}, listRooms: () => [room], destroy: () => {}, sendSignal: () => {},
    subscribeRooms: () => () => {}, subscribeSignals: () => () => {},
  };
  const session = new ClientSession({ directory, peerId: 'client', displayName: 'Client' });
  try {
    await session.connect(room);
    const control = channels.get('beat-control')!;
    const inputChannel = channels.get('beat-input')!;
    control.onopen!();
    inputChannel.onopen!();
    const ruleset = createDefaultRuleset();
    control.onmessage!({ data: JSON.stringify({ type: 'welcome', playerId: 'local', room, ruleset }) });
    now = 1_045;
    control.onmessage!({ data: JSON.stringify({ type: 'pong', sentAtMs: 1_000, receivedAtMs: 51_020, serverSentAtMs: 51_025,
      timing: { tick: 30, nextTickAtMs: 51_100, intervalMs: 1_000 / 30 } }) });
    now = 1_046;
    session.submitInput(input(1, [0]));
    now = 1_048;
    session.submitInput(input(2));
    expect(inputChannel.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(14);
    expect(inputChannel.sent).toHaveLength(1);
    const message = JSON.parse(inputChannel.sent[0] as string);
    expect(message.input.sequence).toBe(2);
    expect(message.redundantInputs).toContainEqual(input(1, [0]));
    now = 1_070;
    session.submitInput(input(3));
    now = 1_071;
    control.onmessage!({ data: JSON.stringify({ type: 'timing', timing: { tick: 31, nextTickAtMs: 51_140, intervalMs: 1_000 / 30 } }) });
    await vi.advanceTimersByTimeAsync(24);
    expect(inputChannel.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6);
    expect(inputChannel.sent).toHaveLength(2);
    now = 1_105;
    session.submitInput(input(4));
    session.destroy();
    await vi.advanceTimersByTimeAsync(100);
    expect(inputChannel.sent).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally { session.destroy(); }
});

it('shares host preparation, bounds reliable keyframes, negotiates v1, and pushes only phase changes', async () => {
  vi.useFakeTimers();
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval });
  class Connection {
    ondatachannel?: (event: { channel: Channel }) => void;
    constructor() { connections.push(this); }
    async setRemoteDescription() {}
    async createAnswer() { return { type: 'answer', sdp: 'test' }; }
    async setLocalDescription() {}
    close() {}
  }
  const connections: Connection[] = [];
  vi.stubGlobal('RTCPeerConnection', Connection);
  let deliverSignal!: (signal: RoomSignal) => void;
  let answerSent: () => void = () => {};
  const room: RoomInfo = { roomId: 'room', hostPeerId: 'host', name: 'Room', rulesetId: 'rules', rulesetHash: 'hash', contentHash: 'hash', mapBundleId: 'map',
    playerCount: 1, maxPlayers: 6, transport: 'webrtc', status: 'open', createdAt: 0, lastHeartbeat: 0 };
  const directory: RoomDirectory = {
    advertiseRoom: () => {}, closeRoom: () => {}, listRooms: () => [room], destroy: () => {},
    sendSignal: (signal) => { if (signal.kind === 'answer') answerSent(); }, subscribeRooms: () => () => {},
    subscribeSignals: (_id, listener) => { deliverSignal = listener; return () => {}; },
  };
  let deliverTiming: ((timing: EngineTickTiming) => void) | undefined;
  const engine = { tickTiming: () => ({ tick: 1, nextTickAtMs: 1_000, intervalMs: 1_000 / 30 }),
    onTiming: (listener: (timing: EngineTickTiming) => void) => { deliverTiming = listener; return () => { deliverTiming = undefined; }; },
    addPlayer: () => {}, removePlayer: () => {},
  } as unknown as EngineClient;
  const ruleset = createDefaultRuleset();
  const host = new HostSession({ directory, room, ruleset, engine, hostPeerId: 'host' });
  const peers: Array<{ control: Channel; snapshots: Channel; keyframes: Channel }> = [];
  try {
    await host.start();
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve) => {
        answerSent = resolve;
        deliverSignal({ signalId: `offer-${i}`, roomId: room.roomId, fromPeerId: `peer-${i}`, toPeerId: 'host', kind: 'offer', payload: { type: 'offer', sdp: 'test' }, createdAt: 0 });
      });
      const connection = connections[i];
      const peer = { control: new Channel('beat-control'), snapshots: new Channel('beat-snapshot'), keyframes: new Channel('beat-keyframe') };
      peers.push(peer);
      for (const channel of Object.values(peer)) connection.ondatachannel!({ channel });
      peer.control.onmessage!({ data: JSON.stringify({ type: 'hello', displayName: `Client-${i}`, snapshotProtocol: 1, ...(i < 2 ? { snapshotCodecVersion: 2 } : {}) }) });
      peer.control.onmessage!({ data: '{"type":"snapshot-ack","tick":-1}' });
    }
    let reads = 0;
    const frame: EngineSnapshot = { tick: 1, nowMs: 0, rulesetId: ruleset.id,
      match: { elapsedTicks: 1, remainingTicks: 100, durationTicks: 100, scoreLimit: 10, finished: false, teams: [] },
      get players() { reads++; return []; }, objectives: [], projectiles: [], physicsBodies: [], constraints: [], effects: [], combatTexts: [], mechanicTraces: [], aiTraces: [] };
    host.broadcastSnapshot(frame);
    expect(reads).toBe(1);
    expect(peers[0].keyframes.sent).toHaveLength(1);
    expect(peers[0].snapshots.sent).toHaveLength(0);
    expect((peers[2].snapshots.sent[0] as Uint8Array)[2]).toBe(1);
    now = 200;
    host.broadcastSnapshot({ ...frame, tick: 2 });
    expect(peers[0].keyframes.sent).toHaveLength(1);
    for (const peer of peers) peer.control.onmessage!({ data: '{"type":"snapshot-ack","tick":1}' });
    now = 300;
    host.broadcastSnapshot({ ...frame, tick: 3 });
    expect(peers[0].snapshots.sent).toHaveLength(1);
    now = 400;
    host.broadcastSnapshot({ ...frame, tick: 64 });
    expect(peers[0].keyframes.sent).toHaveLength(2);
    now = 500;
    host.broadcastSnapshot({ ...frame, tick: 65 });
    expect(peers[0].snapshots.sent).toHaveLength(2); // Deltas continue during periodic keyframe delivery.
    const notices = () => peers[0].control.sent.filter((message) => typeof message === 'string' && JSON.parse(message).type === 'timing');
    deliverTiming!({ tick: 2, nextTickAtMs: 1_000 + 1_000 / 30, intervalMs: 1_000 / 30 });
    expect(notices()).toHaveLength(0);
    deliverTiming!({ tick: 3, nextTickAtMs: 1_000 + 2_000 / 30 + 8, intervalMs: 1_000 / 30 });
    expect(notices()).toHaveLength(1);
    deliverTiming!({ tick: 4, nextTickAtMs: 1_108, intervalMs: 1_000 / 30 });
    expect(notices()).toHaveLength(1);
  } finally { host.destroy(); }
  expect(deliverTiming).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

function input(sequence: number, castSlots: number[] = []): PlayerInput {
  return { sequence, moveX: 1, moveY: 0, aimDx: 1, aimDy: 0, castSlots, slotPresses: [], slotReleases: [], sampledAtMs: sequence * 10 };
}
