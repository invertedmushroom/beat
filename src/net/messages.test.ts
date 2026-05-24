import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import type { RoomInfo } from '../rooms/directory';
import { decodeClientMessage, decodeHostMessage, encodeMessage } from './messages';

function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: 'room_1',
    hostPeerId: 'peer_host',
    name: 'Room',
    rulesetId: 'rules',
    rulesetHash: 'rules_hash',
    contentHash: 'content_hash',
    mapBundleId: 'map',
    playerCount: 1,
    maxPlayers: 4,
    transport: 'webrtc',
    status: 'open',
    createdAt: 1,
    lastHeartbeat: 1,
    ...overrides,
  };
}

describe('net message decoding guards', () => {
  it('accepts valid client hello and rejects blank display names', () => {
    expect(decodeClientMessage(encodeMessage({ type: 'hello', displayName: 'Player' }))).toEqual({ type: 'hello', displayName: 'Player' });
    expect(decodeClientMessage(JSON.stringify({ type: 'hello', displayName: '' }))).toBeUndefined();
  });

  it('accepts valid client input and rejects malformed payloads', () => {
    expect(
      decodeClientMessage(
        JSON.stringify({
          type: 'input',
          input: {
            sequence: 1,
            moveX: 0,
            moveY: 1,
            aimDx: 1,
            aimDy: 0,
            castSlots: [],
            slotPresses: [0],
            slotReleases: [],
            sampledAtMs: 12,
          },
        }),
      ),
    ).toBeTruthy();

    expect(
      decodeClientMessage(
        JSON.stringify({
          type: 'input',
          input: {
            sequence: '1',
            moveX: 0,
            moveY: 1,
            aimDx: 1,
            aimDy: 0,
            castSlots: [],
            slotPresses: [],
            slotReleases: [],
            sampledAtMs: 12,
          },
        }),
      ),
    ).toBeUndefined();
  });

  it('accepts welcome messages with a valid room shape', () => {
    const ruleset = createDefaultRuleset();
    const welcome = {
      type: 'welcome' as const,
      playerId: 'player_1',
      room: roomInfo(),
      ruleset,
    };
    expect(decodeHostMessage(JSON.stringify(welcome))).toEqual(welcome);
  });

  it('rejects welcome messages when room payload is malformed', () => {
    const ruleset = createDefaultRuleset();
    const malformed = {
      type: 'welcome',
      playerId: 'player_1',
      room: {
        ...roomInfo(),
        maxPlayers: '4',
      },
      ruleset,
    };
    expect(decodeHostMessage(JSON.stringify(malformed))).toBeUndefined();
  });
});
