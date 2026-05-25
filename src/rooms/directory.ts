export type RoomStatus = 'open' | 'full' | 'closed';

export type RoomInfo = {
  roomId: string;
  hostPeerId: string;
  name: string;
  rulesetId: string;
  rulesetName?: string;
  rulesetHash: string;
  contentHash: string;
  mapBundleId: string;
  playerCount: number;
  maxPlayers: number;
  transport: 'webrtc';
  status: RoomStatus;
  createdAt: number;
  lastHeartbeat: number;
};

export type SignalKind = 'offer' | 'answer' | 'ice';

export type RoomSignal = {
  signalId: string;
  roomId: string;
  fromPeerId: string;
  toPeerId: string;
  kind: SignalKind;
  payload: unknown;
  createdAt: number;
};

export type RoomDirectory = {
  advertiseRoom(room: RoomInfo): void | Promise<void>;
  closeRoom(roomId: string): void | Promise<void>;
  listRooms(): RoomInfo[];
  refreshRooms?(): void | Promise<void>;
  subscribeRooms(listener: (rooms: RoomInfo[]) => void): () => void;
  requestJoinRoom?(roomId: string, peerId: string, displayName: string): void | Promise<void>;
  sendSignal(signal: RoomSignal): void | Promise<void>;
  subscribeSignals(peerId: string, listener: (signal: RoomSignal) => void): () => void;
  destroy(): void;
};
