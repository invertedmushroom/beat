import type { EngineTickTiming, PlayerInput, Ruleset } from '../engine/protocol';
import type { RoomInfo } from '../rooms/directory';
import type { NetworkSnapshot } from './compactSnapshot';
import { isNetworkSnapshot } from './compactSnapshot';
import { validateRuleset } from '../engine/rulesValidation';

const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_REDUNDANT_INPUTS = 64;
const MAX_INPUT_EVENTS = 16;

export type ClientToHostMessage =
  | { type: 'hello'; displayName: string; snapshotProtocol?: 1; snapshotCodecVersion?: 2 }
  | { type: 'input'; input: PlayerInput; redundantInputs?: PlayerInput[] }
  | { type: 'ping'; sentAtMs: number }
  | { type: 'snapshot-ack'; tick: number }
  | { type: 'leave' };

export type HostToClientMessage =
  | { type: 'welcome'; playerId: string; room: RoomInfo; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: NetworkSnapshot }
  | { type: 'notice'; message: string }
  | { type: 'host-closed' }
  | { type: 'timing'; timing: EngineTickTiming }
  | { type: 'pong'; sentAtMs: number; receivedAtMs: number; serverSentAtMs?: number; timing?: EngineTickTiming };

export function encodeMessage(message: ClientToHostMessage | HostToClientMessage): string {
  return JSON.stringify(message);
}

export function decodeClientMessage(raw: string): ClientToHostMessage | undefined {
  return decodeMessage<ClientToHostMessage>(raw, isClientMessage);
}

export function decodeHostMessage(raw: string): HostToClientMessage | undefined {
  const message = decodeMessage<HostToClientMessage>(raw, isHostMessage);
  if (message?.type !== 'welcome') return message;
  try {
    return { ...message, ruleset: validateRuleset(message.ruleset) };
  } catch {
    return undefined;
  }
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
      return typeof value.displayName === 'string' && value.displayName.trim().length > 0 && value.displayName.length <= MAX_DISPLAY_NAME_LENGTH &&
        (value.snapshotProtocol === undefined || value.snapshotProtocol === 1) &&
        (value.snapshotCodecVersion === undefined || (value.snapshotProtocol === 1 && value.snapshotCodecVersion === 2));
    case 'ping':
      return isFiniteNumber(value.sentAtMs);
    case 'leave':
      return true;
    case 'snapshot-ack':
      return Number.isSafeInteger(value.tick) && (value.tick as number) >= -1 && (value.tick as number) < 0xffffffff;
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
      return isNetworkSnapshot(value.snapshot);
    case 'notice':
      return typeof value.message === 'string';
    case 'host-closed':
      return true;
    case 'timing':
      return isTickTiming(value.timing);
    case 'pong':
      return isFiniteNumber(value.sentAtMs) && isFiniteNumber(value.receivedAtMs) &&
        (value.serverSentAtMs === undefined || (isFiniteNumber(value.serverSentAtMs) && value.serverSentAtMs >= value.receivedAtMs)) &&
        (value.timing === undefined || isTickTiming(value.timing));
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
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isTickTiming(value: unknown): value is EngineTickTiming {
  return isRecord(value) && isSafeInteger(value.tick) && value.tick >= 0 && isFiniteNumber(value.nextTickAtMs) &&
    isFiniteNumber(value.intervalMs) && value.intervalMs >= 1 && value.intervalMs <= 1_000;
}
