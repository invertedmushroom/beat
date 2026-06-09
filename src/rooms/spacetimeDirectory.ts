import { DbConnection, tables, type SubscriptionHandle } from '../module_bindings';
import type { HostedRoom, HostedRoomSignal } from '../module_bindings/types';
import type { RoomDirectory, RoomInfo, RoomSignal, SignalKind } from './directory';

const TOKEN_KEY_PREFIX = 'beat:stdb-token:';
const ROOM_TTL_MS = 10_000;

export type SpacetimeRoomDirectoryConfig = {
  uri: string;
  database: string;
};

export class SpacetimeRoomDirectory implements RoomDirectory {
  private readonly roomListeners = new Set<(rooms: RoomInfo[]) => void>();
  private readonly signalListeners = new Map<string, Set<(signal: RoomSignal) => void>>();
  private readonly signalSubscriptions = new Map<string, SubscriptionHandle>();
  private readonly hostedRooms = new Map<string, RoomInfo>();
  private readonly advertisedRooms = new Set<string>();
  private readonly rooms = new Map<string, RoomInfo>();
  private readonly seenSignals = new Set<string>();
  private ready: Promise<DbConnection>;
  private connection?: DbConnection;
  private connectionActive = false;
  private roomSubscription?: SubscriptionHandle;
  private pruneHandle?: number;
  private destroyed = false;

  constructor(private readonly config: SpacetimeRoomDirectoryConfig) {
    this.ready = this.connect();
    this.ready.catch((error: unknown) => console.warn('SpacetimeDB directory connection failed', error));
    this.pruneHandle = window.setInterval(() => {
      void this.ensureConnectedAndRefresh();
    }, 30_000);
  }

  async advertiseRoom(room: RoomInfo): Promise<void> {
    this.hostedRooms.set(room.roomId, room);
    await this.withConnection(async (connection) => {
      if (this.advertisedRooms.has(room.roomId)) {
        await connection.reducers.heartbeatHostedRoom({
          roomId: room.roomId,
          playerCount: room.playerCount,
          status: room.status,
        });
        return;
      }

      await connection.reducers.createHostedRoom({
        roomId: room.roomId,
        hostPeerId: room.hostPeerId,
        name: room.name,
        rulesetId: room.rulesetId,
        rulesetHash: room.rulesetHash,
        contentHash: room.contentHash,
        mapBundleId: room.mapBundleId,
        playerCount: room.playerCount,
        maxPlayers: room.maxPlayers,
        transport: room.transport,
        status: room.status,
      });
      this.advertisedRooms.add(room.roomId);
    });
  }

  async closeRoom(roomId: string): Promise<void> {
    this.hostedRooms.delete(roomId);
    this.advertisedRooms.delete(roomId);
    this.rooms.delete(roomId);
    this.emitRooms();
    await this.withConnection((connection) => connection.reducers.closeHostedRoom({ roomId }));
  }

  listRooms(): RoomInfo[] {
    return activeRooms([...this.rooms.values()]);
  }

  async refreshRooms(): Promise<void> {
    await this.ensureConnectedAndRefresh();
  }

  private async ensureConnectedAndRefresh(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    if (!this.connectionActive) {
      this.reconnect();
    }
    this.emitRoomsFromCache();
    await this.withConnection(async (connection) => {
      await connection.reducers.pruneHostedRooms({});
      await this.reAdvertiseHostedRooms(connection);
    });
  }

  subscribeRooms(listener: (rooms: RoomInfo[]) => void): () => void {
    this.roomListeners.add(listener);
    listener(this.listRooms());
    return () => this.roomListeners.delete(listener);
  }

  async requestJoinRoom(roomId: string, peerId: string, displayName: string): Promise<void> {
    await this.withConnection((connection) =>
      connection.reducers.requestJoinHostedRoom({
        roomId,
        peerId,
        displayName,
      }),
    );
  }

  async leaveRoom(roomId: string, peerId: string): Promise<void> {
    await this.withConnection((connection) =>
      connection.reducers.leaveHostedRoom({
        roomId,
        peerId,
      }),
    );
  }

  async sendSignal(signal: RoomSignal): Promise<void> {
    await this.withConnection(async (connection) => {
      if (signal.kind === 'answer') {
        await connection.reducers.acceptJoinHostedRoom({
          roomId: signal.roomId,
          peerId: signal.toPeerId,
        });
      }
      await connection.reducers.sendHostedRoomSignal({
        signalId: signal.signalId,
        roomId: signal.roomId,
        fromPeerId: signal.fromPeerId,
        toPeerId: signal.toPeerId,
        signalKind: signal.kind,
        payloadJson: JSON.stringify(signal.payload),
      });
    });
  }

  subscribeSignals(peerId: string, listener: (signal: RoomSignal) => void): () => void {
    const listeners = this.signalListeners.get(peerId) ?? new Set<(signal: RoomSignal) => void>();
    listeners.add(listener);
    this.signalListeners.set(peerId, listeners);
    void this.ensureSignalSubscription(peerId);
    this.dispatchCachedSignals(peerId);

    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) {
        return;
      }
      this.signalListeners.delete(peerId);
      const subscription = this.signalSubscriptions.get(peerId);
      if (subscription && !subscription.isEnded()) {
        subscription.unsubscribe();
      }
      this.signalSubscriptions.delete(peerId);
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pruneHandle !== undefined) {
      window.clearInterval(this.pruneHandle);
      this.pruneHandle = undefined;
    }
    for (const subscription of this.signalSubscriptions.values()) {
      if (!subscription.isEnded()) {
        subscription.unsubscribe();
      }
    }
    if (this.roomSubscription && !this.roomSubscription.isEnded()) {
      this.roomSubscription.unsubscribe();
    }
    this.connection?.disconnect();
    this.roomListeners.clear();
    this.signalListeners.clear();
    this.signalSubscriptions.clear();
  }

  private connect(): Promise<DbConnection> {
    const tokenKey = `${TOKEN_KEY_PREFIX}${this.config.uri}:${this.config.database}`;
    const token = window.localStorage.getItem(tokenKey) ?? undefined;
    let resolveReady!: (connection: DbConnection) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<DbConnection>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const builder = DbConnection.builder()
      .withUri(this.config.uri)
      .withDatabaseName(this.config.database)
      .withToken(token)
      .onConnect((connection, _identity, nextToken) => {
        window.localStorage.setItem(tokenKey, nextToken);
        this.connection = connection;
        this.connectionActive = true;
        this.advertisedRooms.clear();
        this.installRoomCallbacks(connection);
        this.installSignalCallbacks(connection);
        this.roomSubscription = connection
          .subscriptionBuilder()
          .onApplied(() => this.emitRoomsFromCache())
          .onError((ctx) => console.warn('Room subscription failed', ctx.event))
          .subscribe(tables.hostedRoom);
        for (const peerId of this.signalListeners.keys()) {
          void this.ensureSignalSubscription(peerId);
        }
        void connection.reducers.pruneHostedRooms({});
        void this.reAdvertiseHostedRooms(connection);
        resolveReady(connection);
      })
      .onConnectError((_ctx, error) => {
        this.connectionActive = false;
        rejectReady(error);
      })
      .onDisconnect(() => {
        this.connectionActive = false;
        for (const subscription of this.signalSubscriptions.values()) {
          if (!subscription.isEnded()) {
            subscription.unsubscribe();
          }
        }
        this.signalSubscriptions.clear();
        if (this.roomSubscription && !this.roomSubscription.isEnded()) {
          this.roomSubscription.unsubscribe();
        }
        this.roomSubscription = undefined;
      });

    const connection = builder.build();
    this.connection = connection;
    return ready;
  }

  private reconnect(): void {
    if (this.destroyed) {
      return;
    }
    try {
      this.connection?.disconnect();
    } catch {
      // ignore — connection may already be dead
    }
    this.connection = undefined;
    this.connectionActive = false;
    this.advertisedRooms.clear();
    this.ready = this.connect();
    this.ready.catch((error: unknown) => console.warn('SpacetimeDB directory reconnect failed', error));
  }

  private async reAdvertiseHostedRooms(connection: DbConnection): Promise<void> {
    for (const room of this.hostedRooms.values()) {
      try {
        if (this.advertisedRooms.has(room.roomId)) {
          await connection.reducers.heartbeatHostedRoom({
            roomId: room.roomId,
            playerCount: room.playerCount,
            status: room.status,
          });
        } else {
          await connection.reducers.createHostedRoom({
            roomId: room.roomId,
            hostPeerId: room.hostPeerId,
            name: room.name,
            rulesetId: room.rulesetId,
            rulesetHash: room.rulesetHash,
            contentHash: room.contentHash,
            mapBundleId: room.mapBundleId,
            playerCount: room.playerCount,
            maxPlayers: room.maxPlayers,
            transport: room.transport,
            status: room.status,
          });
          this.advertisedRooms.add(room.roomId);
        }
      } catch (error) {
        console.warn('Re-advertise hosted room failed', room.roomId, error);
      }
    }
  }

  private installRoomCallbacks(connection: DbConnection): void {
    connection.db.hostedRoom.onInsert((_ctx, row) => {
      this.storeRoom(row);
    });
    connection.db.hostedRoom.onUpdate((_ctx, _oldRow, row) => {
      this.storeRoom(row);
    });
    connection.db.hostedRoom.onDelete((_ctx, row) => {
      this.rooms.delete(row.roomId);
      this.emitRooms();
    });
  }

  private installSignalCallbacks(connection: DbConnection): void {
    connection.db.hostedRoomSignal.onInsert((_ctx, row) => {
      this.dispatchSignalRow(row);
    });
  }

  private async ensureSignalSubscription(peerId: string): Promise<void> {
    if (this.signalSubscriptions.has(peerId)) {
      return;
    }
    const connection = await this.ready;
    if (this.destroyed || this.signalSubscriptions.has(peerId) || !this.signalListeners.has(peerId)) {
      return;
    }
    const subscription = connection
      .subscriptionBuilder()
      .onApplied(() => this.dispatchCachedSignals(peerId))
      .onError((ctx) => console.warn(`Signal subscription failed for ${peerId}`, ctx.event))
      .subscribe(tables.hostedRoomSignal.where((row) => row.toPeerId.eq(peerId)));
    this.signalSubscriptions.set(peerId, subscription);
  }

  private async withConnection<T>(action: (connection: DbConnection) => T | Promise<T>): Promise<T | undefined> {
    if (this.destroyed) {
      return undefined;
    }
    const connection = await this.ready;
    if (this.destroyed) {
      return undefined;
    }
    return action(connection);
  }

  private storeRoom(row: HostedRoom): void {
    const room = toRoomInfo(row);
    this.rooms.set(room.roomId, room);
    this.emitRooms();
  }

  private emitRoomsFromCache(): void {
    if (!this.connection) {
      return;
    }
    this.rooms.clear();
    for (const row of this.connection.db.hostedRoom.iter()) {
      this.rooms.set(row.roomId, toRoomInfo(row));
    }
    this.emitRooms();
  }

  private emitRooms(): void {
    const rooms = this.listRooms();
    for (const listener of this.roomListeners) {
      listener(rooms);
    }
  }

  private dispatchCachedSignals(peerId: string): void {
    if (!this.connection) {
      return;
    }
    for (const row of this.connection.db.hostedRoomSignal.iter()) {
      if (row.toPeerId === peerId) {
        this.dispatchSignalRow(row);
      }
    }
  }

  private dispatchSignalRow(row: HostedRoomSignal): void {
    const signal = toRoomSignal(row);
    if (!signal || this.seenSignals.has(signal.signalId)) {
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
}

function toRoomInfo(row: HostedRoom): RoomInfo {
  return {
    roomId: row.roomId,
    hostPeerId: row.hostPeerId,
    name: row.name,
    rulesetId: row.rulesetId,
    rulesetHash: row.rulesetHash,
    contentHash: row.contentHash,
    mapBundleId: row.mapBundleId,
    playerCount: row.playerCount,
    maxPlayers: row.maxPlayers,
    transport: 'webrtc',
    status: toRoomStatus(row.status),
    createdAt: Number(row.createdAt.toMillis()),
    lastHeartbeat: Number(row.lastHeartbeat.toMillis()),
  };
}

function toRoomSignal(row: HostedRoomSignal): RoomSignal | undefined {
  if (!isSignalKind(row.signalKind)) {
    return undefined;
  }
  return {
    signalId: row.signalId,
    roomId: row.roomId,
    fromPeerId: row.fromPeerId,
    toPeerId: row.toPeerId,
    kind: row.signalKind,
    payload: parsePayload(row.payloadJson),
    createdAt: Number(row.createdAt.toMillis()),
  };
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return undefined;
  }
}

function isSignalKind(value: string): value is SignalKind {
  return value === 'offer' || value === 'answer' || value === 'ice';
}

function toRoomStatus(value: string): RoomInfo['status'] {
  if (value === 'full' || value === 'closed') {
    return value;
  }
  return 'open';
}

function activeRooms(rooms: RoomInfo[]): RoomInfo[] {
  const now = Date.now();
  return rooms
    .filter((room) => room.status !== 'closed' && now - room.lastHeartbeat < ROOM_TTL_MS)
    .sort(compareRooms);
}

function compareRooms(a: RoomInfo, b: RoomInfo): number {
  return b.createdAt - a.createdAt || a.name.localeCompare(b.name) || a.roomId.localeCompare(b.roomId);
}
