import type { EngineClient } from '../engine/EngineClient';
import type { EngineSnapshot, PlayerInput, Ruleset } from '../engine/protocol';
import type { RoomDirectory, RoomInfo, RoomSignal } from '../rooms/directory';
import { createId } from '../utils/ids';
import { fromNetworkSnapshot, toNetworkSnapshot } from './compactSnapshot';
import { decodeClientMessage, decodeHostMessage, encodeMessage, type ClientToHostMessage } from './messages';
import { PendingInputQueue } from './pendingInputs';
import { describeRtcConfig, getRtcConfig } from './rtcConfig';

const CONTROL_CHANNEL_LABEL = 'beat-control';
const INPUT_CHANNEL_LABEL = 'beat-input';
const SNAPSHOT_CHANNEL_LABEL = 'beat-snapshot';
const LEGACY_CHANNEL_LABEL = 'beat';
const HOST_SNAPSHOT_INTERVAL_MS = 50;
const MAX_SNAPSHOT_BUFFERED_AMOUNT = 64_000;
const CLIENT_CONNECT_TIMEOUT_MS = 15_000;
const MAX_PEER_DISPLAY_NAME_LENGTH = 24;

type LogListener = (message: string) => void;
type SnapshotListener = (snapshot: EngineSnapshot) => void;
type WelcomeListener = (playerId: string, room: RoomInfo, ruleset: Ruleset) => void;
type StatsListener = (stats: NetDiagnostics) => void;
type PeerState = {
  connection: RTCPeerConnection;
  controlChannel?: RTCDataChannel;
  inputChannel?: RTCDataChannel;
  snapshotChannel?: RTCDataChannel;
  playerId?: string;
  displayName?: string;
  sessionId: string;
  remoteDescriptionReady: boolean;
  pendingIce: RTCIceCandidateInit[];
  lastReceivedInputSequence: number;
  lastSnapshotSentAt: number;
  droppedSnapshots: number;
  coalescedSnapshots: number;
  lastSnapshotBytes: number;
  maxBacklogBytes: number;
  candidateType?: string;
  rttMs?: number;
};

export type NetDiagnostics = {
  role: 'host' | 'client';
  peers: number;
  candidateType: string;
  relay: boolean;
  rttMs?: number;
  bytesPerSecond: number;
  lastSnapshotBytes: number;
  droppedSnapshots: number;
  coalescedSnapshots: number;
  backlogBytes: number;
  pendingInputs?: number;
};

export class HostSession {
  private readonly peers = new Map<string, PeerState>();
  private readonly pendingIceByPeer = new Map<string, RoomSignal[]>();
  private readonly logListeners = new Set<LogListener>();
  private readonly statsListeners = new Set<StatsListener>();
  private heartbeatHandle?: number;
  private statsHandle?: number;
  private unsubscribeSignals?: () => void;
  private currentPlayerCount = 1;
  private bytesSent = 0;
  private lastBytesSent = 0;
  private lastStatsAt = performance.now();
  private lastSnapshotBytes = 0;
  private droppedSnapshots = 0;
  private coalescedSnapshots = 0;
  private backlogBytes = 0;

  constructor(
    private readonly options: {
      directory: RoomDirectory;
      engine: EngineClient;
      room: RoomInfo;
      ruleset: Ruleset;
      hostPeerId: string;
    },
  ) {}

  async start(): Promise<void> {
    this.log(describeRtcConfig(await getRtcConfig()));
    try {
      await this.options.directory.advertiseRoom(this.currentRoomInfo());
    } catch (error: unknown) {
      this.log(`room advertise failed: ${readError(error)}`);
    }
    this.heartbeatHandle = window.setInterval(() => this.heartbeat(), 2_000);
    this.statsHandle = window.setInterval(() => void this.reportStats(), 1_000);
    this.unsubscribeSignals = this.options.directory.subscribeSignals(this.options.hostPeerId, (signal) => {
      void this.handleSignal(signal);
    });
  }

  broadcastSnapshot(snapshot: EngineSnapshot): void {
    const message = encodeMessage({ type: 'snapshot', snapshot: toNetworkSnapshot(snapshot) });
    const bytes = message.length;
    const now = performance.now();
    this.lastSnapshotBytes = bytes;
    for (const peer of this.peers.values()) {
      this.sendPeerSnapshot(peer, message, bytes, now);
    }
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  onStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  destroy(): void {
    if (this.heartbeatHandle !== undefined) {
      window.clearInterval(this.heartbeatHandle);
    }
    if (this.statsHandle !== undefined) {
      window.clearInterval(this.statsHandle);
    }
    this.unsubscribeSignals?.();
    void Promise.resolve(this.options.directory.closeRoom(this.options.room.roomId)).catch((error: unknown) => this.log(`room close failed: ${readError(error)}`));
    for (const [peerId, peer] of Array.from(this.peers)) {
      this.closePeer(peerId, peer, true);
    }
  }

  private sendPeerSnapshot(peer: PeerState, message: string, bytes: number, now: number): void {
    const channel = peer.snapshotChannel;
    if (channel?.readyState !== 'open') {
      return;
    }
    peer.maxBacklogBytes = Math.max(peer.maxBacklogBytes, channel.bufferedAmount);
    this.backlogBytes = Math.max(this.backlogBytes, channel.bufferedAmount);
    if (now - peer.lastSnapshotSentAt < HOST_SNAPSHOT_INTERVAL_MS) {
      peer.coalescedSnapshots += 1;
      this.coalescedSnapshots += 1;
      return;
    }
    if (channel.bufferedAmount > MAX_SNAPSHOT_BUFFERED_AMOUNT) {
      peer.droppedSnapshots += 1;
      this.droppedSnapshots += 1;
      return;
    }
    channel.send(message);
    peer.lastSnapshotSentAt = now;
    peer.lastSnapshotBytes = bytes;
    this.bytesSent += bytes;
  }

  private heartbeat(): void {
    this.publishRoomState('room heartbeat failed');
  }

  private currentRoomInfo(): RoomInfo {
    return {
      ...this.options.room,
      playerCount: this.currentPlayerCount,
      status: this.currentPlayerCount >= this.options.room.maxPlayers ? 'full' : 'open',
      lastHeartbeat: Date.now(),
    };
  }

  private publishRoomState(errorPrefix: string): void {
    void Promise.resolve(this.options.directory.advertiseRoom(this.currentRoomInfo())).catch((error: unknown) => this.log(`${errorPrefix}: ${readError(error)}`));
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

    const connection = new RTCPeerConnection(await getRtcConfig());
    const peerState: PeerState = {
      connection,
      sessionId,
      remoteDescriptionReady: false,
      pendingIce: [],
      lastReceivedInputSequence: 0,
      lastSnapshotSentAt: 0,
      droppedSnapshots: 0,
      coalescedSnapshots: 0,
      lastSnapshotBytes: 0,
      maxBacklogBytes: 0,
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
    connection.onicecandidateerror = (event) => {
      this.log(`${shortPeer(signal.fromPeerId)} ice candidate error ${event.errorCode}: ${event.errorText || 'unknown error'}`);
    };
    connection.ondatachannel = (event) => {
      this.configureHostChannel(signal.fromPeerId, peerState, event.channel);
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

  private configureHostChannel(peerId: string, peer: PeerState, channel: RTCDataChannel): void {
    if (channel.label === CONTROL_CHANNEL_LABEL || channel.label === LEGACY_CHANNEL_LABEL) {
      peer.controlChannel = channel;
    }
    if (channel.label === INPUT_CHANNEL_LABEL || channel.label === LEGACY_CHANNEL_LABEL) {
      peer.inputChannel = channel;
    }
    if (channel.label === SNAPSHOT_CHANNEL_LABEL) {
      peer.snapshotChannel = channel;
    }

    channel.onopen = () => this.log(`${channel.label} open: ${peerId}`);
    channel.onerror = () => this.log(`${channel.label} error: ${peerId}`);
    channel.onmessage = (event: MessageEvent<string>) => {
      const message = decodeClientMessage(event.data);
      if (!message) {
        return;
      }
      this.handlePeerMessage(peerId, peer, channel, message);
    };
    channel.onclose = () => {
      if (this.peers.get(peerId) !== peer || channel !== peer.controlChannel) {
        return;
      }
      this.closePeer(peerId, peer, false);
      this.log(`peer left: ${peerId}`);
    };
  }

  private handlePeerMessage(peerId: string, peer: PeerState, channel: RTCDataChannel, message: ClientToHostMessage): void {
    if (message.type === 'hello') {
      this.handleHello(peerId, peer, channel, message.displayName);
      return;
    }
    if (message.type === 'ping') {
      const response = encodeMessage({ type: 'pong', sentAtMs: message.sentAtMs, receivedAtMs: performance.now() });
      if (peer.controlChannel?.readyState === 'open') {
        peer.controlChannel.send(response);
        this.bytesSent += response.length;
      }
      return;
    }
    if (message.type === 'input' && peer.playerId) {
      this.applyPeerInputs(peer, message);
    }
  }

  private handleHello(peerId: string, peer: PeerState, channel: RTCDataChannel, displayName: string): void {
    const normalizedDisplayName = displayName.trim().slice(0, MAX_PEER_DISPLAY_NAME_LENGTH) || 'Player';
    peer.displayName = normalizedDisplayName;
    if (!peer.playerId && this.currentPlayerCount >= this.options.room.maxPlayers) {
      const target = peer.controlChannel?.readyState === 'open' ? peer.controlChannel : channel;
      const notice = encodeMessage({ type: 'notice', message: 'room is full' });
      target.send(notice);
      this.bytesSent += notice.length;
      const closed = encodeMessage({ type: 'host-closed' });
      target.send(closed);
      this.bytesSent += closed.length;
      this.log(`join rejected (room full): ${shortPeer(peerId)}`);
      this.closePeer(peerId, peer, false);
      return;
    }
    if (!peer.playerId) {
      peer.playerId = createId('player');
      const team = this.chooseTeamForNewPeer();
      this.currentPlayerCount += 1;
      this.options.engine.addPlayer({
        playerId: peer.playerId,
        displayName: normalizedDisplayName,
        hue: hueFromString(peer.playerId),
        local: false,
        team,
      });
      this.publishRoomState('room heartbeat failed');
    }
    const response = encodeMessage({ type: 'welcome', playerId: peer.playerId, room: this.currentRoomInfo(), ruleset: this.options.ruleset });
    const target = peer.controlChannel?.readyState === 'open' ? peer.controlChannel : channel;
    target.send(response);
    this.bytesSent += response.length;
    this.log(`${normalizedDisplayName} joined`);
  }

  private applyPeerInputs(peer: PeerState, message: Extract<ClientToHostMessage, { type: 'input' }>): void {
    const inputs = [...(message.redundantInputs ?? []), message.input].sort((a, b) => a.sequence - b.sequence);
    for (const input of inputs) {
      if (input.sequence <= peer.lastReceivedInputSequence) {
        continue;
      }
      peer.lastReceivedInputSequence = input.sequence;
      this.options.engine.submitInput(peer.playerId ?? '', input);
    }
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

  private chooseTeamForNewPeer(): string {
    const teams = this.options.ruleset.match.teams;
    if (teams.length === 0) {
      return 'players';
    }
    const index = this.currentPlayerCount % teams.length;
    return teams[index].id;
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
    this.closePeer(peerId, existing, false);
  }

  private closePeer(peerId: string, peer: PeerState, notifyHostClosed: boolean): void {
    let removedPlayer = false;
    if (peer.playerId) {
      removedPlayer = true;
      this.options.engine.removePlayer(peer.playerId);
      this.currentPlayerCount = Math.max(1, this.currentPlayerCount - 1);
    }
    if (notifyHostClosed && peer.controlChannel?.readyState === 'open') {
      peer.controlChannel.send(encodeMessage({ type: 'host-closed' }));
    }
    for (const channel of [peer.controlChannel, peer.inputChannel, peer.snapshotChannel]) {
      if (channel) {
        channel.onclose = null;
        channel.onerror = null;
        channel.onmessage = null;
        channel.onopen = null;
        channel.close();
      }
    }
    peer.connection.close();
    this.peers.delete(peerId);
    if (removedPlayer) {
      this.publishRoomState('room heartbeat failed');
    }
  }

  private bindConnectionLogs(connection: RTCPeerConnection, label: string): void {
    connection.onconnectionstatechange = () => this.log(`${label} connection ${connection.connectionState}`);
    connection.oniceconnectionstatechange = () => this.log(`${label} ice ${connection.iceConnectionState}`);
  }

  private async reportStats(): Promise<void> {
    await this.refreshConnectionStats();
    const now = performance.now();
    const elapsedSeconds = Math.max(0.001, (now - this.lastStatsAt) / 1000);
    const bytesPerSecond = (this.bytesSent - this.lastBytesSent) / elapsedSeconds;
    this.lastStatsAt = now;
    this.lastBytesSent = this.bytesSent;
    const peers = Array.from(this.peers.values());
    const candidateType = peers.find((peer) => peer.candidateType === 'relay')?.candidateType ?? peers.find((peer) => peer.candidateType)?.candidateType ?? 'unknown';
    const rttMs = average(peers.map((peer) => peer.rttMs).filter((value): value is number => value !== undefined));
    const backlogBytes = Math.max(this.backlogBytes, ...peers.map((peer) => peer.snapshotChannel?.bufferedAmount ?? 0));
    const stats: NetDiagnostics = {
      role: 'host',
      peers: peers.length,
      candidateType,
      relay: candidateType === 'relay',
      rttMs,
      bytesPerSecond,
      lastSnapshotBytes: this.lastSnapshotBytes,
      droppedSnapshots: this.droppedSnapshots,
      coalescedSnapshots: this.coalescedSnapshots,
      backlogBytes,
    };
    this.backlogBytes = 0;
    for (const listener of this.statsListeners) {
      listener(stats);
    }
  }

  private async refreshConnectionStats(): Promise<void> {
    for (const peer of this.peers.values()) {
      await refreshPeerConnectionStats(peer.connection, (stats) => {
        peer.candidateType = stats.candidateType ?? peer.candidateType;
        peer.rttMs = stats.rttMs ?? peer.rttMs;
      });
    }
  }

  private log(message: string): void {
    for (const listener of this.logListeners) {
      listener(message);
    }
  }
}

export class ClientSession {
  private connection?: RTCPeerConnection;
  private controlChannel?: RTCDataChannel;
  private inputChannel?: RTCDataChannel;
  private snapshotChannel?: RTCDataChannel;
  private unsubscribeSignals?: () => void;
  private unsubscribeRooms?: () => void;
  private hostSilenceHandle?: number;
  private statsHandle?: number;
  private currentRoom?: RoomInfo;
  private readonly sessionId = createId('session');
  private readonly pendingIce: RTCIceCandidateInit[] = [];
  private readonly pendingInputQueue = new PendingInputQueue();
  private remoteDescriptionReady = false;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly welcomeListeners = new Set<WelcomeListener>();
  private readonly logListeners = new Set<LogListener>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly statsListeners = new Set<StatsListener>();
  private localPlayerId?: string;
  private disconnected = false;
  private lastHostMessageAt = 0;
  private sawRoomInDirectory = false;
  private receivedFirstSnapshot = false;
  private bytesReceived = 0;
  private lastBytesReceived = 0;
  private lastStatsAt = performance.now();
  private lastSnapshotBytes = 0;
  private backlogBytes = 0;
  private candidateType = 'unknown';
  private rttMs: number | undefined;

  constructor(
    private readonly options: {
      directory: RoomDirectory;
      peerId: string;
      displayName: string;
    },
  ) {}

  async connect(room: RoomInfo): Promise<void> {
    this.currentRoom = room;
    this.disconnected = false;
    this.lastHostMessageAt = Date.now();
    this.sawRoomInDirectory = false;
    this.receivedFirstSnapshot = false;
    const rtcConfig = await getRtcConfig();
    this.log(describeRtcConfig(rtcConfig));
    this.connection = new RTCPeerConnection(rtcConfig);
    this.controlChannel = this.connection.createDataChannel(CONTROL_CHANNEL_LABEL);
    this.inputChannel = this.connection.createDataChannel(INPUT_CHANNEL_LABEL, { ordered: false, maxRetransmits: 1 });
    this.snapshotChannel = this.connection.createDataChannel(SNAPSHOT_CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 });
    this.bindConnectionLogs(this.connection, `client->${shortPeer(room.hostPeerId)}`);
    this.configureClientChannels();
    this.unsubscribeRooms = this.options.directory.subscribeRooms((rooms) => this.handleRooms(rooms));
    this.hostSilenceHandle = window.setInterval(() => this.checkHostSilence(), 1_000);
    this.statsHandle = window.setInterval(() => void this.reportStats(), 1_000);

    this.connection.onicecandidate = (event) => {
      if (event.candidate) {
        void Promise.resolve(
          this.options.directory.sendSignal(makeSignal(room.roomId, this.options.peerId, room.hostPeerId, 'ice', wrapSignalPayload(this.sessionId, event.candidate.toJSON()))),
        ).catch((error: unknown) => this.log(`ice send failed: ${readError(error)}`));
      }
    };
    this.connection.onicecandidateerror = (event) => {
      this.log(`client ice candidate error ${event.errorCode}: ${event.errorText || 'unknown error'}`);
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
    this.pendingInputQueue.push(input);
    const channel = this.inputChannel;
    if (channel?.readyState === 'open') {
      const message = encodeMessage({ type: 'input', input, redundantInputs: this.pendingInputQueue.redundantEventInputs() });
      channel.send(message);
      this.backlogBytes = Math.max(this.backlogBytes, channel.bufferedAmount);
    }
  }

  pendingInputs(): PlayerInput[] {
    return this.pendingInputQueue.snapshot();
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

  onStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  destroy(): void {
    this.disconnected = true;
    this.cleanupTransport();
    this.pendingIce.length = 0;
    this.currentRoom = undefined;
    this.localPlayerId = undefined;
    this.sawRoomInDirectory = false;
    this.receivedFirstSnapshot = false;
    this.lastHostMessageAt = 0;
  }

  private handleRooms(rooms: RoomInfo[]): void {
    if (this.disconnected || !this.currentRoom) {
      return;
    }
    const roomOpen = rooms.some((room) => room.roomId === this.currentRoom?.roomId && room.status !== 'closed');
    if (roomOpen) {
      this.sawRoomInDirectory = true;
      return;
    }
    if (!this.sawRoomInDirectory || !this.localPlayerId) {
      return;
    }
    this.log('room closed');
    this.notifyDisconnect();
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

  private configureClientChannels(): void {
    this.configureClientControlChannel();
    this.configureClientInputChannel();
    this.configureClientSnapshotChannel();
    if (!this.connection) {
      return;
    }
    this.connection.onconnectionstatechange = () => {
      const state = this.connection?.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.log(`connection ${state}`);
        this.notifyDisconnect();
      }
    };
  }

  private configureClientControlChannel(): void {
    const channel = this.controlChannel;
    if (!channel) {
      return;
    }
    channel.onopen = () => {
      channel.send(encodeMessage({ type: 'hello', displayName: this.options.displayName }));
      this.log('control channel open');
    };
    channel.onerror = () => this.log('control channel error');
    channel.onclose = () => {
      this.log('control channel closed');
      this.notifyDisconnect();
    };
    channel.onmessage = (event: MessageEvent<string>) => this.handleHostMessage(event.data, event.data.length);
  }

  private configureClientInputChannel(): void {
    const channel = this.inputChannel;
    if (!channel) {
      return;
    }
    channel.onopen = () => this.log('input channel open');
    channel.onerror = () => this.log('input channel error');
  }

  private configureClientSnapshotChannel(): void {
    const channel = this.snapshotChannel;
    if (!channel) {
      return;
    }
    channel.onopen = () => this.log('snapshot channel open');
    channel.onerror = () => this.log('snapshot channel error');
    channel.onmessage = (event: MessageEvent<string>) => this.handleHostMessage(event.data, event.data.length);
  }

  private handleHostMessage(raw: string, bytes: number): void {
    const message = decodeHostMessage(raw);
    if (!message) {
      return;
    }
    this.bytesReceived += bytes;
    this.lastHostMessageAt = Date.now();
    if (message.type === 'host-closed') {
      this.log('host closed room');
      this.notifyDisconnect();
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
      this.receivedFirstSnapshot = true;
      this.lastSnapshotBytes = bytes;
      const snapshot = fromNetworkSnapshot(message.snapshot);
      const local = this.localPlayerId ? snapshot.players.find((player) => player.playerId === this.localPlayerId) : undefined;
      if (local) {
        this.pendingInputQueue.ackUpTo(local.lastInputSequence);
      }
      for (const listener of this.snapshotListeners) {
        listener(snapshot);
      }
      return;
    }
    if (message.type === 'notice') {
      this.log(message.message);
      return;
    }
    if (message.type === 'pong') {
      this.rttMs = Math.max(0, performance.now() - message.sentAtMs);
    }
  }

  private checkHostSilence(): void {
    if (this.disconnected) {
      return;
    }
    const silenceMs = Date.now() - this.lastHostMessageAt;
    if (!this.receivedFirstSnapshot) {
      if (silenceMs > CLIENT_CONNECT_TIMEOUT_MS) {
        this.log('connection timed out before first snapshot');
        this.notifyDisconnect();
      }
      return;
    }
    if (silenceMs > CLIENT_CONNECT_TIMEOUT_MS) {
      this.log('host timed out');
      this.notifyDisconnect();
    }
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

  private async reportStats(): Promise<void> {
    if (this.controlChannel?.readyState === 'open') {
      this.controlChannel.send(encodeMessage({ type: 'ping', sentAtMs: performance.now() }));
    }
    if (this.connection) {
      await refreshPeerConnectionStats(this.connection, (stats) => {
        this.candidateType = stats.candidateType ?? this.candidateType;
        this.rttMs = stats.rttMs ?? this.rttMs;
      });
    }
    const now = performance.now();
    const elapsedSeconds = Math.max(0.001, (now - this.lastStatsAt) / 1000);
    const bytesPerSecond = (this.bytesReceived - this.lastBytesReceived) / elapsedSeconds;
    this.lastStatsAt = now;
    this.lastBytesReceived = this.bytesReceived;
    const backlogBytes = Math.max(
      this.backlogBytes,
      this.controlChannel?.bufferedAmount ?? 0,
      this.inputChannel?.bufferedAmount ?? 0,
      this.snapshotChannel?.bufferedAmount ?? 0,
    );
    this.backlogBytes = 0;
    const stats: NetDiagnostics = {
      role: 'client',
      peers: this.connection ? 1 : 0,
      candidateType: this.candidateType,
      relay: this.candidateType === 'relay',
      rttMs: this.rttMs,
      bytesPerSecond,
      lastSnapshotBytes: this.lastSnapshotBytes,
      droppedSnapshots: 0,
      coalescedSnapshots: 0,
      backlogBytes,
      pendingInputs: this.pendingInputQueue.size(),
    };
    for (const listener of this.statsListeners) {
      listener(stats);
    }
  }

  private log(message: string): void {
    for (const listener of this.logListeners) {
      listener(message);
    }
  }

  private notifyDisconnect(): void {
    if (this.disconnected) {
      return;
    }
    this.disconnected = true;
    this.cleanupTransport();
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }

  private cleanupTransport(): void {
    this.unsubscribeSignals?.();
    this.unsubscribeSignals = undefined;
    this.unsubscribeRooms?.();
    this.unsubscribeRooms = undefined;
    if (this.hostSilenceHandle !== undefined) {
      window.clearInterval(this.hostSilenceHandle);
      this.hostSilenceHandle = undefined;
    }
    if (this.statsHandle !== undefined) {
      window.clearInterval(this.statsHandle);
      this.statsHandle = undefined;
    }
    for (const channel of [this.controlChannel, this.inputChannel, this.snapshotChannel]) {
      if (channel) {
        channel.onclose = null;
        channel.onerror = null;
        channel.onmessage = null;
        channel.onopen = null;
        channel.close();
      }
    }
    if (this.connection) {
      this.connection.onconnectionstatechange = null;
      this.connection.onicecandidate = null;
      this.connection.oniceconnectionstatechange = null;
    }
    this.connection?.close();
    this.controlChannel = undefined;
    this.inputChannel = undefined;
    this.snapshotChannel = undefined;
    this.connection = undefined;
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

async function refreshPeerConnectionStats(connection: RTCPeerConnection, apply: (stats: { candidateType?: string; rttMs?: number }) => void): Promise<void> {
  try {
    const report = await connection.getStats();
    let selectedPairId: string | undefined;
    report.forEach((entry) => {
      const value = entry as RTCStats & Record<string, unknown>;
      if (value.type === 'transport' && typeof value['selectedCandidatePairId'] === 'string') {
        selectedPairId = value['selectedCandidatePairId'];
      }
    });
    let pair: (RTCStats & Record<string, unknown>) | undefined;
    report.forEach((entry) => {
      const value = entry as RTCStats & Record<string, unknown>;
      if (
        (selectedPairId && value.id === selectedPairId) ||
        (value.type === 'candidate-pair' && (value['selected'] === true || (value['nominated'] === true && value['state'] === 'succeeded')))
      ) {
        pair = value;
      }
    });
    if (!pair) {
      return;
    }
    const localCandidateId = typeof pair['localCandidateId'] === 'string' ? pair['localCandidateId'] : undefined;
    const remoteCandidateId = typeof pair['remoteCandidateId'] === 'string' ? pair['remoteCandidateId'] : undefined;
    const localCandidate = localCandidateId ? (report.get(localCandidateId) as (RTCStats & Record<string, unknown>) | undefined) : undefined;
    const remoteCandidate = remoteCandidateId ? (report.get(remoteCandidateId) as (RTCStats & Record<string, unknown>) | undefined) : undefined;
    const candidateType = readCandidateType(localCandidate) ?? readCandidateType(remoteCandidate);
    const rttSeconds = typeof pair['currentRoundTripTime'] === 'number' ? pair['currentRoundTripTime'] : undefined;
    apply({
      candidateType,
      rttMs: rttSeconds === undefined ? undefined : rttSeconds * 1000,
    });
  } catch {
    // Some browsers restrict getStats during early ICE states; diagnostics are best effort.
  }
}

function readCandidateType(candidate: (RTCStats & Record<string, unknown>) | undefined): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const candidateType = candidate['candidateType'];
  return typeof candidateType === 'string' ? candidateType : undefined;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
