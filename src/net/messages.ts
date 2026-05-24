import type { PlayerInput, Ruleset } from '../engine/protocol';
import type { RoomInfo } from '../rooms/directory';
import type { NetworkSnapshot } from './compactSnapshot';

export type ClientToHostMessage =
  | { type: 'hello'; displayName: string }
  | { type: 'input'; input: PlayerInput; redundantInputs?: PlayerInput[] }
  | { type: 'ping'; sentAtMs: number };

export type HostToClientMessage =
  | { type: 'welcome'; playerId: string; room: RoomInfo; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: NetworkSnapshot }
  | { type: 'notice'; message: string }
  | { type: 'host-closed' }
  | { type: 'pong'; sentAtMs: number; receivedAtMs: number };

export function encodeMessage(message: ClientToHostMessage | HostToClientMessage): string {
  return JSON.stringify(message);
}

export function decodeClientMessage(raw: string): ClientToHostMessage | undefined {
  return decodeMessage<ClientToHostMessage>(raw, ['hello', 'input', 'ping']);
}

export function decodeHostMessage(raw: string): HostToClientMessage | undefined {
  return decodeMessage<HostToClientMessage>(raw, ['welcome', 'snapshot', 'notice', 'host-closed', 'pong']);
}

function decodeMessage<T extends { type: string }>(raw: string, allowed: string[]): T | undefined {
  try {
    const parsed = JSON.parse(raw) as T;
    return allowed.includes(parsed.type) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
