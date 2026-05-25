import type { RoomDirectory, RoomInfo, RoomSignal } from './directory';

const ROOMS_KEY = 'beat:rooms:v1';
const SIGNALS_KEY = 'beat:signals:v1';
const CHANNEL_NAME = 'beat-directory-v1';
const ROOM_TTL_MS = 8_000;
const SIGNAL_TTL_MS = 120_000;

type ChannelMessage =
  | { type: 'rooms' }
  | { type: 'signal'; signal: RoomSignal };

export class LocalRoomDirectory implements RoomDirectory {
  private readonly channel = new BroadcastChannel(CHANNEL_NAME);
  private readonly roomListeners = new Set<(rooms: RoomInfo[]) => void>();
  private readonly signalListeners = new Map<string, Set<(signal: RoomSignal) => void>>();
  private readonly seenSignals = new Set<string>();
  private readonly pollHandle: number;

  constructor() {
    this.channel.addEventListener('message', (event: MessageEvent<ChannelMessage>) => {
      if (event.data.type === 'rooms') {
        this.emitRooms();
      } else {
        this.dispatchSignal(event.data.signal);
      }
    });
    this.pollHandle = window.setInterval(() => {
      this.prune();
      this.emitRooms();
      this.pollSignals();
    }, 1_000);
  }

  advertiseRoom(room: RoomInfo): void {
    const rooms = this.readRooms().filter((candidate) => candidate.roomId !== room.roomId);
    rooms.push({ ...room, lastHeartbeat: Date.now() });
    this.writeRooms(rooms);
    this.channel.postMessage({ type: 'rooms' } satisfies ChannelMessage);
    this.emitRooms();
  }

  closeRoom(roomId: string): void {
    this.writeRooms(this.readRooms().filter((room) => room.roomId !== roomId));
    this.channel.postMessage({ type: 'rooms' } satisfies ChannelMessage);
    this.emitRooms();
  }

  listRooms(): RoomInfo[] {
    return this.activeRooms();
  }

  refreshRooms(): void {
    this.prune();
    this.emitRooms();
    this.pollSignals();
  }

  subscribeRooms(listener: (rooms: RoomInfo[]) => void): () => void {
    this.roomListeners.add(listener);
    listener(this.activeRooms());
    return () => this.roomListeners.delete(listener);
  }

  sendSignal(signal: RoomSignal): void {
    const signals = this.readSignals().filter((candidate) => candidate.signalId !== signal.signalId);
    signals.push(signal);
    this.writeSignals(signals);
    this.channel.postMessage({ type: 'signal', signal } satisfies ChannelMessage);
    this.dispatchSignal(signal);
  }

  subscribeSignals(peerId: string, listener: (signal: RoomSignal) => void): () => void {
    const listeners = this.signalListeners.get(peerId) ?? new Set();
    listeners.add(listener);
    this.signalListeners.set(peerId, listeners);
    this.pollSignals();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.signalListeners.delete(peerId);
      }
    };
  }

  destroy(): void {
    window.clearInterval(this.pollHandle);
    this.channel.close();
    this.roomListeners.clear();
    this.signalListeners.clear();
  }

  private emitRooms(): void {
    const rooms = this.activeRooms();
    for (const listener of this.roomListeners) {
      listener(rooms);
    }
  }

  private dispatchSignal(signal: RoomSignal): void {
    if (this.seenSignals.has(signal.signalId)) {
      return;
    }
    this.seenSignals.add(signal.signalId);
    const listeners = this.signalListeners.get(signal.toPeerId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(signal);
    }
  }

  private pollSignals(): void {
    for (const signal of this.readSignals()) {
      this.dispatchSignal(signal);
    }
  }

  private prune(): void {
    const now = Date.now();
    this.writeRooms(this.readRooms().filter((room) => room.status !== 'closed' && now - room.lastHeartbeat < ROOM_TTL_MS));
    this.writeSignals(this.readSignals().filter((signal) => now - signal.createdAt < SIGNAL_TTL_MS));
  }

  private activeRooms(): RoomInfo[] {
    const now = Date.now();
    return this.readRooms()
      .filter((room) => room.status !== 'closed' && now - room.lastHeartbeat < ROOM_TTL_MS)
      .sort(compareRooms);
  }

  private readRooms(): RoomInfo[] {
    return readJson<RoomInfo[]>(ROOMS_KEY, []);
  }

  private writeRooms(rooms: RoomInfo[]): void {
    window.localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  }

  private readSignals(): RoomSignal[] {
    return readJson<RoomSignal[]>(SIGNALS_KEY, []);
  }

  private writeSignals(signals: RoomSignal[]): void {
    window.localStorage.setItem(SIGNALS_KEY, JSON.stringify(signals));
  }
}

function compareRooms(a: RoomInfo, b: RoomInfo): number {
  return b.createdAt - a.createdAt || a.name.localeCompare(b.name) || a.roomId.localeCompare(b.roomId);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
