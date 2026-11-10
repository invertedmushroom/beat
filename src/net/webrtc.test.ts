import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { PlayerInput } from '../engine/protocol';
import type { RoomDirectory, RoomInfo } from '../rooms/directory';
import { ClientSession } from './webrtc';

vi.mock('./rtcConfig', () => ({ getRtcConfig: async () => ({ iceServers: [] }), describeRtcConfig: () => 'test ICE' }));

class Channel {
  readyState = 'open';
  bufferedAmount = 0;
  binaryType = 'blob';
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  readonly sent: string[] = [];
  constructor(readonly label: string) {}
  send(data: string): void { this.sent.push(data); }
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
    const message = JSON.parse(inputChannel.sent[0]);
    expect(message.input.sequence).toBe(2);
    expect(message.redundantInputs).toContainEqual(input(1, [0]));
    now = 1_070;
    session.submitInput(input(3));
    session.destroy();
    await vi.advanceTimersByTimeAsync(100);
    expect(inputChannel.sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { session.destroy(); }
});

function input(sequence: number, castSlots: number[] = []): PlayerInput {
  return { sequence, moveX: 1, moveY: 0, aimDx: 1, aimDy: 0, castSlots, slotPresses: [], slotReleases: [], sampledAtMs: sequence * 10 };
}
