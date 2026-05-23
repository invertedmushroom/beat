import type { EngineClient } from '../engine/EngineClient';
import type { EngineSnapshot, PlayerInput, Ruleset } from '../engine/protocol';
import type { RoomDirectory, RoomInfo, RoomSignal } from '../rooms/directory';
import { createId } from '../utils/ids';
import { decodeClientMessage, decodeHostMessage, encodeMessage } from './messages';

type LogListener = (message: string) => void;
type SnapshotListener = (snapshot: EngineSnapshot) => void;
type WelcomeListener = (playerId: string, room: RoomInfo, ruleset: Ruleset) => void;
type PeerState = {
  connection: RTCPeerConnection;
  channel?: RTCDataChannel;
  playerId?: string;
  displayName?: string;
  sessionId: string;
  remoteDescriptionReady: boolean;
  pendingIce: RTCIceCandidateInit[];
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export class HostSession {
  private readonly peers = new Map<string, PeerState>();
  private readonly pendingIceByPeer = new Map<string, RoomSignal[]>();
  private readonly logListeners = new Set<LogListener>();
  private heartbeatHandle?: number;
  private unsubscribeSignals?: () => void;
  private currentPlayerCount = 1;

  constructor(
    private readonly options: {
      directory: RoomDirectory;
      engine: EngineClient;
      room: RoomInfo;
      ruleset: Ruleset;
      hostPeerId: string;
    },
  ) {}

  start(): void {
    void Promise.resolve(this.options.directory.advertiseRoom(this.options.room)).catch((error: unknown) => this.log(`room advertise failed: ${readError(error)}`));
    this.heartbeatHandle = window.setInterval(() => this.heartbeat(), 2_000);
    this.unsubscribeSignals = this.options.directory.subscribeSignals(this.options.hostPeerId, (signal) => {
      void this.handleSignal(signal);
    });
  }

  broadcastSnapshot(snapshot: EngineSnapshot): void {
    const message = encodeMessage({ type: 'snapshot', snapshot });
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === 'open') {
        peer.channel.send(message);
      }
    }
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  destroy(): void {
    if (this.heartbeatHandle !== undefined) {
      window.clearInterval(this.heartbeatHandle);
    }
    this.unsubscribeSignals?.();
    void Promise.resolve(this.options.directory.closeRoom(this.options.room.roomId)).catch((error: unknown) => this.log(`room close failed: ${readError(error)}`));
    for (const [peerId, peer] of this.peers) {
      if (peer.playerId) {
        this.options.engine.removePlayer(peer.playerId);
      }
      peer.channel?.close();
      peer.connection.close();
      this.peers.delete(peerId);
    }
  }

  private heartbeat(): void {
    const room = {
      ...this.options.room,
      playerCount: this.currentPlayerCount,
      lastHeartbeat: Date.now(),
    };
    void Promise.resolve(this.options.directory.advertiseRoom(room)).catch((error: unknown) => this.log(`room heartbeat failed: ${readError(error)}`));
  }

  private async handleSignal(signal: RoomSignal): Promise<void> {
    if (signal.roomId !== this.options.room.roomId) {
      return;
    }
    if (signal.kind === 'offer') {
      await this.acceptOffer(signal);
      return;
    }
    const peer = this.peers.get(signal.fromPeerId);
    if (signal.kind !== 'ice') {
      return;
    }
    if (!peer) {
      this.queuePendingIce(signal);
      return;
    }
    await this.addIceToPeer(peer, signal);
  }

  private async acceptOffer(signal: RoomSignal): Promise<void> {
    const offerPayload = unwrapSignalPayload<RTCSessionDescriptionInit>(signal.payload);
    const sessionId = offerPayload.sessionId ?? signal.signalId;
    this.replacePeer(signal.fromPeerId);

    const connection = new RTCPeerConnection(RTC_CONFIG);
    const peerState: PeerState = {
      connection,
      sessionId,
      remoteDescriptionReady: false,
      pendingIce: [],
    };
    this.peers.set(signal.fromPeerId, peerState);
    this.bindConnectionLogs(connection, `host<-${shortPeer(signal.fromPeerId)}`);

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        void Promise.resolve(
          this.options.directory.sendSignal(
            makeSignal(this.options.room.roomId, this.options.hostPeerId, signal.fromPeerId, 'ice', wrapSignalPayload(sessionId, event.candidate.toJSON())),
          ),
        ).catch((error: unknown) => this.log(`ice send failed: ${readError(error)}`));
      }
    };
    connection.ondatachannel = (event) => {
      peerState.channel = event.channel;
      this.configureHostChannel(signal.fromPeerId, peerState);
    };

    await connection.setRemoteDescription(offerPayload.value);
    peerState.remoteDescriptionReady = true;
    await this.flushPeerIce(peerState);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await this.options.directory.sendSignal(makeSignal(this.options.room.roomId, this.options.hostPeerId, signal.fromPeerId, 'answer', wrapSignalPayload(sessionId, answer)));
    this.log(`answer sent to ${signal.fromPeerId}`);
    await this.flushQueuedIce(signal.fromPeerId, peerState);
  }

  private configureHostChannel(peerId: string, peer: PeerState): void {
    const channel = peer.channel;
    if (!channel) {
      return;
    }
    channel.onopen = () => this.log(`data channel open: ${peerId}`);
    channel.onerror = () => this.log(`data channel error: ${peerId}`);
    channel.onmessage = (event: MessageEvent<string>) => {
      const message = decodeClientMessage(event.data);
      if (!message) {
        return;
      }
      if (message.type === 'hello') {
        peer.displayName = message.displayName;
        if (!peer.playerId) {
          peer.playerId = createId('player');
          this.currentPlayerCount += 1;
          this.options.engine.addPlayer({
            playerId: peer.playerId,
            displayName: message.displayName,
            hue: hueFromString(peer.playerId),
            local: false,
          });
        }
        channel.send(encodeMessage({ type: 'welcome', playerId: peer.playerId, room: this.options.room, ruleset: this.options.ruleset }));
        this.log(`${message.displayName} joined`);
        return;
      }
      if (message.type === 'input' && peer.playerId) {
        this.options.engine.submitInput(peer.playerId, message.input);
      }
    };
    channel.onclose = () => {
      if (this.peers.get(peerId) !== peer) {
        return;
      }
      if (peer.playerId) {
        this.options.engine.removePlayer(peer.playerId);
        this.currentPlayerCount = Math.max(1, this.currentPlayerCount - 1);
      }
      this.peers.delete(peerId);
      this.log(`peer left: ${peerId}`);
    };
  }

  private async addIceToPeer(peer: PeerState, signal: RoomSignal): Promise<void> {
    const icePayload = unwrapSignalPayload<RTCIceCandidateInit>(signal.payload);
    if (icePayload.sessionId && icePayload.sessionId !== peer.sessionId) {
      return;
    }
    if (!peer.remoteDescriptionReady) {
      peer.pendingIce.push(icePayload.value);
      return;
    }
    await peer.connection.addIceCandidate(icePayload.value).catch((error: unknown) => this.log(`host ice add failed: ${readError(error)}`));
  }

  private async flushPeerIce(peer: PeerState): Promise<void> {
    const pending = peer.pendingIce.splice(0);
    for (const candidate of pending) {
      await peer.connection.addIceCandidate(candidate).catch((error: unknown) => this.log(`host queued ice failed: ${readError(error)}`));
    }
  }

  private queuePendingIce(signal: RoomSignal): void {
    const signals = this.pendingIceByPeer.get(signal.fromPeerId) ?? [];
    signals.push(signal);
    this.pendingIceByPeer.set(signal.fromPeerId, signals.slice(-16));
  }

  private async flushQueuedIce(peerId: string, peer: PeerState): Promise<void> {
    const signals = this.pendingIceByPeer.get(peerId) ?? [];
    this.pendingIceByPeer.delete(peerId);
    for (const signal of signals) {
      await this.addIceToPeer(peer, signal);
    }
  }

  private replacePeer(peerId: string): void {
    const existing = this.peers.get(peerId);
    if (!existing) {
      return;
    }
    if (existing.playerId) {
      this.options.engine.removePlayer(existing.playerId);
      this.currentPlayerCount = Math.max(1, this.currentPlayerCount - 1);
    }
    if (existing.channel) {
      existing.channel.onclose = null;
      existing.channel.onerror = null;
      existing.channel.onmessage = null;
      existing.channel.onopen = null;
    }
    existing.channel?.close();
    existing.connection.close();
    this.peers.delete(peerId);
  }

  private bindConnectionLogs(connection: RTCPeerConnection, label: string): void {
    connection.onconnectionstatechange = () => this.log(`${label} connection ${connection.connectionState}`);
    connection.oniceconnectionstatechange = () => this.log(`${label} ice ${connection.iceConnectionState}`);
  }

  private log(message: string): void {
    for (const listener of this.logListeners) {
      listener(message);
    }
  }
}

export class ClientSession {
  private connection?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private unsubscribeSignals?: () => void;
  private currentRoom?: RoomInfo;
  private readonly sessionId = createId('session');
  private readonly pendingIce: RTCIceCandidateInit[] = [];
  private remoteDescriptionReady = false;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly welcomeListeners = new Set<WelcomeListener>();
  private readonly logListeners = new Set<LogListener>();
  private localPlayerId?: string;

  constructor(
    private readonly options: {
      directory: RoomDirectory;
      peerId: string;
      displayName: string;
    },
  ) {}

  async connect(room: RoomInfo): Promise<void> {
    this.currentRoom = room;
    this.connection = new RTCPeerConnection(RTC_CONFIG);
    this.channel = this.connection.createDataChannel('beat');
    this.bindConnectionLogs(this.connection, `client->${shortPeer(room.hostPeerId)}`);
    this.configureClientChannel();

    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        void Promise.resolve(
          this.options.directory.sendSignal(makeSignal(room.roomId, this.options.peerId, room.hostPeerId, 'ice', wrapSignalPayload(this.sessionId, event.candidate.toJSON()))),
        ).catch((error: unknown) => this.log(`ice send failed: ${readError(error)}`));
      }
    };

    await this.options.directory.requestJoinRoom?.(room.roomId, this.options.peerId, this.options.displayName);

    this.unsubscribeSignals = this.options.directory.subscribeSignals(this.options.peerId, (signal) => {
      void this.handleSignal(signal);
    });

    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    await this.options.directory.sendSignal(makeSignal(room.roomId, this.options.peerId, room.hostPeerId, 'offer', wrapSignalPayload(this.sessionId, offer)));
    this.log(`offer sent to ${room.name}`);
  }

  submitInput(input: PlayerInput): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(encodeMessage({ type: 'input', input }));
    }
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onWelcome(listener: WelcomeListener): () => void {
    this.welcomeListeners.add(listener);
    return () => this.welcomeListeners.delete(listener);
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  destroy(): void {
    this.unsubscribeSignals?.();
    this.channel?.close();
    this.connection?.close();
    this.pendingIce.length = 0;
  }

  private async handleSignal(signal: RoomSignal): Promise<void> {
    if (!this.connection || signal.toPeerId !== this.options.peerId || signal.roomId !== this.currentRoom?.roomId) {
      return;
    }
    if (signal.kind === 'answer') {
      const answerPayload = unwrapSignalPayload<RTCSessionDescriptionInit>(signal.payload);
      if (answerPayload.sessionId && answerPayload.sessionId !== this.sessionId) {
        return;
      }
      await this.connection.setRemoteDescription(answerPayload.value);
      this.remoteDescriptionReady = true;
      await this.flushIce();
      this.log('answer received');
      return;
    }
    if (signal.kind === 'ice') {
      const icePayload = unwrapSignalPayload<RTCIceCandidateInit>(signal.payload);
      if (icePayload.sessionId && icePayload.sessionId !== this.sessionId) {
        return;
      }
      if (!this.remoteDescriptionReady) {
        this.pendingIce.push(icePayload.value);
        return;
      }
      await this.connection.addIceCandidate(icePayload.value).catch((error: unknown) => this.log(`client ice add failed: ${readError(error)}`));
    }
  }

  private configureClientChannel(): void {
    if (!this.channel) {
      return;
    }
    this.channel.onopen = () => {
      this.channel?.send(encodeMessage({ type: 'hello', displayName: this.options.displayName }));
      this.log('data channel open');
    };
    this.channel.onerror = () => this.log('data channel error');
    this.channel.onclose = () => this.log('data channel closed');
    this.channel.onmessage = (event: MessageEvent<string>) => {
      const message = decodeHostMessage(event.data);
      if (!message) {
        return;
      }
      if (message.type === 'welcome') {
        this.localPlayerId = message.playerId;
        for (const listener of this.welcomeListeners) {
          listener(message.playerId, message.room, message.ruleset);
        }
        return;
      }
      if (message.type === 'snapshot') {
        for (const listener of this.snapshotListeners) {
          listener(message.snapshot);
        }
        return;
      }
      this.log(message.message);
    };
  }

  private async flushIce(): Promise<void> {
    if (!this.connection) {
      return;
    }
    const pending = this.pendingIce.splice(0);
    for (const candidate of pending) {
      await this.connection.addIceCandidate(candidate).catch((error: unknown) => this.log(`client queued ice failed: ${readError(error)}`));
    }
  }

  private bindConnectionLogs(connection: RTCPeerConnection, label: string): void {
    connection.onconnectionstatechange = () => this.log(`${label} connection ${connection.connectionState}`);
    connection.oniceconnectionstatechange = () => this.log(`${label} ice ${connection.iceConnectionState}`);
  }

  private log(message: string): void {
    for (const listener of this.logListeners) {
      listener(message);
    }
  }
}

function makeSignal(roomId: string, fromPeerId: string, toPeerId: string, kind: RoomSignal['kind'], payload: unknown): RoomSignal {
  return {
    signalId: createId('signal'),
    roomId,
    fromPeerId,
    toPeerId,
    kind,
    payload,
    createdAt: Date.now(),
  };
}

function hueFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrapSignalPayload<T>(sessionId: string, value: T): { sessionId: string; value: T } {
  return { sessionId, value };
}

function unwrapSignalPayload<T>(payload: unknown): { sessionId?: string; value: T } {
  if (isRecord(payload) && typeof payload.sessionId === 'string' && 'value' in payload) {
    return { sessionId: payload.sessionId, value: payload.value as T };
  }
  return { value: payload as T };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shortPeer(peerId: string): string {
  return peerId.slice(-8);
}
