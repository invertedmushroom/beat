import type { EngineSnapshot, PlayerInput, Ruleset } from '../engine/protocol';
import type { RoomInfo } from '../rooms/directory';

export type ClientToHostMessage =
  | { type: 'hello'; displayName: string }
  | { type: 'input'; input: PlayerInput };

export type HostToClientMessage =
  | { type: 'welcome'; playerId: string; room: RoomInfo; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: EngineSnapshot }
  | { type: 'notice'; message: string }
  | { type: 'host-closed' };

export function encodeMessage(message: ClientToHostMessage | HostToClientMessage): string {
  return JSON.stringify(message);
}

export function decodeClientMessage(raw: string): ClientToHostMessage | undefined {
  return decodeMessage<ClientToHostMessage>(raw, ['hello', 'input']);
}

export function decodeHostMessage(raw: string): HostToClientMessage | undefined {
  return decodeMessage<HostToClientMessage>(raw, ['welcome', 'snapshot', 'notice', 'host-closed']);
}

function decodeMessage<T extends { type: string }>(raw: string, allowed: string[]): T | undefined {
  try {
    const parsed = JSON.parse(raw) as T;
    return allowed.includes(parsed.type) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
