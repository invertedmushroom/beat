import type { PlayerInput, Ruleset } from '../engine/protocol';
import type { RoomInfo } from '../rooms/directory';
import type { NetworkSnapshot } from './compactSnapshot';

const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_REDUNDANT_INPUTS = 64;
const MAX_INPUT_EVENTS = 16;

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
  return decodeMessage<ClientToHostMessage>(raw, isClientMessage);
}

export function decodeHostMessage(raw: string): HostToClientMessage | undefined {
  return decodeMessage<HostToClientMessage>(raw, isHostMessage);
}

function decodeMessage<T>(raw: string, validate: (value: unknown) => value is T): T | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validate(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isClientMessage(value: unknown): value is ClientToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'hello':
      return typeof value.displayName === 'string' && value.displayName.trim().length > 0 && value.displayName.length <= MAX_DISPLAY_NAME_LENGTH;
    case 'ping':
      return isFiniteNumber(value.sentAtMs);
    case 'input':
      if (!isPlayerInput(value.input)) {
        return false;
      }
      if (value.redundantInputs === undefined) {
        return true;
      }
      return (
        Array.isArray(value.redundantInputs) &&
        value.redundantInputs.length <= MAX_REDUNDANT_INPUTS &&
        value.redundantInputs.every((entry) => isPlayerInput(entry))
      );
    default:
      return false;
  }
}

function isHostMessage(value: unknown): value is HostToClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'welcome':
      return typeof value.playerId === 'string' && value.playerId.length > 0 && isRoomInfoLike(value.room) && isRecord(value.ruleset);
    case 'snapshot':
      return isRecord(value.snapshot);
    case 'notice':
      return typeof value.message === 'string';
    case 'host-closed':
      return true;
    case 'pong':
      return isFiniteNumber(value.sentAtMs) && isFiniteNumber(value.receivedAtMs);
    default:
      return false;
  }
}

function isPlayerInput(value: unknown): value is PlayerInput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isFiniteNumber(value.moveX) &&
    isFiniteNumber(value.moveY) &&
    isFiniteNumber(value.aimDx) &&
    isFiniteNumber(value.aimDy) &&
    isInputEventArray(value.castSlots) &&
    isInputEventArray(value.slotPresses) &&
    isInputEventArray(value.slotReleases) &&
    isFiniteNumber(value.sampledAtMs)
  );
}

function isRoomInfoLike(value: unknown): value is RoomInfo {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.roomId === 'string' &&
    typeof value.hostPeerId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.rulesetId === 'string' &&
    typeof value.rulesetHash === 'string' &&
    typeof value.contentHash === 'string' &&
    typeof value.mapBundleId === 'string' &&
    isSafeInteger(value.playerCount) &&
    isSafeInteger(value.maxPlayers) &&
    value.transport === 'webrtc' &&
    (value.status === 'open' || value.status === 'full' || value.status === 'closed') &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.lastHeartbeat)
  );
}

function isInputEventArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= MAX_INPUT_EVENTS && value.every((entry) => isSafeInteger(entry) && entry >= 0 && entry <= 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
