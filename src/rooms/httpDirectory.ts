import type { RoomDirectory, RoomInfo, RoomSignal } from './directory';

type DirectoryEvent =
  | { type: 'rooms'; rooms: RoomInfo[] }
  | { type: 'signal'; signal: RoomSignal };

export class HttpRoomDirectory implements RoomDirectory {
  private readonly baseUrl: URL;
  private readonly roomListeners = new Set<(rooms: RoomInfo[]) => void>();
  private readonly signalListeners = new Map<string, Set<(signal: RoomSignal) => void>>();
  private readonly seenSignals = new Set<string>();
  private roomsCache: RoomInfo[] = [];
  private pollHandle?: number;
  private eventSource?: EventSource;

  constructor(baseUrl: string) {
    this.baseUrl = new URL(baseUrl);
    this.startPolling();
  }

  advertiseRoom(room: RoomInfo): void {
    void this.request(`/rooms/${encodeURIComponent(room.roomId)}`, {
      method: 'PUT',
      body: JSON.stringify(room),
    }).then(() => void this.refreshRooms());
  }

  closeRoom(roomId: string): void {
    void this.request(`/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' }).then(() => void this.refreshRooms());
  }

  listRooms(): RoomInfo[] {
    return [...this.roomsCache];
  }

  async refreshRooms(): Promise<void> {
    this.roomsCache = await this.fetchRooms();
    this.notifyRooms();
  }

  subscribeRooms(listener: (rooms: RoomInfo[]) => void): () => void {
    this.roomListeners.add(listener);
    listener(this.listRooms());
    void this.refreshRooms();
    return () => this.roomListeners.delete(listener);
  }

  sendSignal(signal: RoomSignal): void {
    void this.request('/signals', {
      method: 'POST',
      body: JSON.stringify(signal),
    });
  }

  subscribeSignals(peerId: string, listener: (signal: RoomSignal) => void): () => void {
    const listeners = this.signalListeners.get(peerId) ?? new Set();
    listeners.add(listener);
    this.signalListeners.set(peerId, listeners);
    this.connectEvents(peerId);
    void this.pollSignals(peerId);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.signalListeners.delete(peerId);
      }
      if (this.signalListeners.size === 0) {
        this.eventSource?.close();
        this.eventSource = undefined;
      }
    };
  }

  destroy(): void {
    if (this.pollHandle !== undefined) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
    this.eventSource?.close();
    this.roomListeners.clear();
    this.signalListeners.clear();
  }

  private startPolling(): void {
    this.pollHandle = window.setInterval(() => {
      void this.refreshRooms();
      for (const peerId of this.signalListeners.keys()) {
        void this.pollSignals(peerId);
      }
    }, 1_500);
  }

  private notifyRooms(): void {
    if (this.roomListeners.size === 0) {
      return;
    }
    for (const listener of this.roomListeners) {
      listener(this.listRooms());
    }
  }

  private async fetchRooms(): Promise<RoomInfo[]> {
    return this.request<RoomInfo[]>('/rooms', { method: 'GET' }).catch(() => []);
  }

  private async pollSignals(peerId: string): Promise<void> {
    const signals = await this.request<RoomSignal[]>(`/signals?peerId=${encodeURIComponent(peerId)}`, { method: 'GET' }).catch(
      () => [],
    );
    for (const signal of signals) {
      this.dispatchSignal(signal);
    }
  }

  private connectEvents(peerId: string): void {
    if (this.eventSource) {
      return;
    }
    const url = this.resolve(`/events?peerId=${encodeURIComponent(peerId)}`);
    this.eventSource = new EventSource(url.href);
    this.eventSource.onmessage = (event) => {
      const message = parseJson<DirectoryEvent>(event.data);
      if (!message) {
        return;
      }
      if (message.type === 'rooms') {
        this.roomsCache = message.rooms;
        this.notifyRooms();
      } else {
        this.dispatchSignal(message.signal);
      }
    };
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

  private async request<T = void>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(this.resolve(path), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`directory request failed: ${response.status} ${response.statusText}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private resolve(path: string): URL {
    return new URL(path.replace(/^\//, ''), appendSlash(this.baseUrl));
  }
}

function appendSlash(url: URL): URL {
  const next = new URL(url);
  if (!next.pathname.endsWith('/')) {
    next.pathname = `${next.pathname}/`;
  }
  return next;
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

