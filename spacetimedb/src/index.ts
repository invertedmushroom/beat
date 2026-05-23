import type { Identity } from 'spacetimedb';
import { schema, table, t, SenderError, type ReducerCtx } from 'spacetimedb/server';

const ROOM_TTL_MS = 8_000;
const SIGNAL_TTL_MS = 120_000;
const MAX_NAME_LENGTH = 36;
const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_HASH_LENGTH = 128;
const MAX_SIGNAL_PAYLOAD_LENGTH = 64_000;

const hostedRoom = table(
  { name: 'hosted_room', public: true },
  {
    roomId: t.string().primaryKey(),
    hostIdentity: t.identity(),
    hostPeerId: t.string().index('btree'),
    name: t.string(),
    rulesetId: t.string(),
    rulesetHash: t.string(),
    contentHash: t.string(),
    mapBundleId: t.string(),
    playerCount: t.u32(),
    maxPlayers: t.u32(),
    transport: t.string(),
    status: t.string().index('btree'),
    createdAt: t.timestamp(),
    lastHeartbeat: t.timestamp().index('btree'),
  }
);

const hostedRoomPeer = table(
  { name: 'hosted_room_peer', public: true },
  {
    membershipId: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    peerIdentity: t.identity(),
    peerId: t.string().index('btree'),
    displayName: t.string(),
    state: t.string().index('btree'),
    joinedAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const hostedRoomSignal = table(
  { name: 'hosted_room_signal', public: true },
  {
    signalId: t.string().primaryKey(),
    roomId: t.string().index('btree'),
    fromPeerId: t.string().index('btree'),
    toPeerId: t.string().index('btree'),
    signalKind: t.string().index('btree'),
    payloadJson: t.string(),
    createdAt: t.timestamp().index('btree'),
  }
);

const spacetimedb = schema({
  hostedRoom,
  hostedRoomPeer,
  hostedRoomSignal,
});
export default spacetimedb;

export const init = spacetimedb.init(() => {
  console.info('Beat room directory ready');
});

export const createHostedRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    hostPeerId: t.string(),
    name: t.string(),
    rulesetId: t.string(),
    rulesetHash: t.string(),
    contentHash: t.string(),
    mapBundleId: t.string(),
    playerCount: t.u32(),
    maxPlayers: t.u32(),
    transport: t.string(),
    status: t.string(),
  },
  (ctx, args) => {
    assertRoomShape(args);
    const existing = ctx.db.hostedRoom.roomId.find(args.roomId);
    if (existing && !sameIdentity(existing.hostIdentity, ctx.sender)) {
      throw new SenderError('Only the room host may replace this room');
    }

    const next = {
      ...args,
      hostIdentity: ctx.sender,
      createdAt: existing?.createdAt ?? ctx.timestamp,
      lastHeartbeat: ctx.timestamp,
    };

    if (existing) {
      ctx.db.hostedRoom.roomId.update(next);
    } else {
      ctx.db.hostedRoom.insert(next);
    }
  }
);

export const heartbeatHostedRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    playerCount: t.u32(),
    status: t.string(),
  },
  (ctx, { roomId, playerCount, status }) => {
    assertStatus(status);
    const room = requireOwnedRoom(ctx, roomId);
    ctx.db.hostedRoom.roomId.update({
      ...room,
      playerCount: clampPlayerCount(playerCount, room.maxPlayers),
      status,
      lastHeartbeat: ctx.timestamp,
    });
  }
);

export const closeHostedRoom = spacetimedb.reducer({ roomId: t.string() }, (ctx, { roomId }) => {
  requireOwnedRoom(ctx, roomId);
  removeRoom(ctx, roomId);
});

export const requestJoinHostedRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    peerId: t.string(),
    displayName: t.string(),
  },
  (ctx, { roomId, peerId, displayName }) => {
    const room = requireOpenRoom(ctx, roomId);
    const membershipId = makeMembershipId(roomId, peerId);
    const existing = ctx.db.hostedRoomPeer.membershipId.find(membershipId);
    if (existing && !sameIdentity(existing.peerIdentity, ctx.sender)) {
      throw new SenderError('This peer id is already owned by another identity');
    }

    const next = {
      membershipId,
      roomId,
      peerIdentity: ctx.sender,
      peerId: assertId(peerId, 'peerId'),
      displayName: clampText(displayName, MAX_DISPLAY_NAME_LENGTH, 'displayName'),
      state: existing?.state === 'accepted' ? 'accepted' : 'pending',
      joinedAt: existing?.joinedAt ?? ctx.timestamp,
      updatedAt: ctx.timestamp,
    };

    if (existing) {
      ctx.db.hostedRoomPeer.membershipId.update(next);
    } else {
      ctx.db.hostedRoomPeer.insert(next);
    }

    ctx.db.hostedRoom.roomId.update({
      ...room,
      lastHeartbeat: room.lastHeartbeat,
    });
  }
);

export const acceptJoinHostedRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    peerId: t.string(),
  },
  (ctx, { roomId, peerId }) => {
    requireOwnedRoom(ctx, roomId);
    const membership = requireMembership(ctx, roomId, peerId);
    ctx.db.hostedRoomPeer.membershipId.update({
      ...membership,
      state: 'accepted',
      updatedAt: ctx.timestamp,
    });
  }
);

export const leaveHostedRoom = spacetimedb.reducer(
  {
    roomId: t.string(),
    peerId: t.string(),
  },
  (ctx, { roomId, peerId }) => {
    const membership = requireMembership(ctx, roomId, peerId);
    if (!sameIdentity(membership.peerIdentity, ctx.sender)) {
      throw new SenderError('Only the peer may leave with this peer id');
    }
    ctx.db.hostedRoomPeer.membershipId.delete(membership.membershipId);
    ctx.db.hostedRoomSignal.toPeerId.delete(peerId);
    ctx.db.hostedRoomSignal.fromPeerId.delete(peerId);
  }
);

export const sendHostedRoomSignal = spacetimedb.reducer(
  {
    signalId: t.string(),
    roomId: t.string(),
    fromPeerId: t.string(),
    toPeerId: t.string(),
    signalKind: t.string(),
    payloadJson: t.string(),
  },
  (ctx, args) => {
    const room = requireOpenRoom(ctx, args.roomId);
    assertSignal(args.signalKind, args.payloadJson);

    const senderIsHost = room.hostPeerId === args.fromPeerId && sameIdentity(room.hostIdentity, ctx.sender);
    if (!senderIsHost) {
      const membership = requireMembership(ctx, args.roomId, args.fromPeerId);
      if (!sameIdentity(membership.peerIdentity, ctx.sender)) {
        throw new SenderError('Only the peer owner may send from this peer id');
      }
    }

    if (ctx.db.hostedRoomSignal.signalId.find(args.signalId)) {
      return;
    }

    ctx.db.hostedRoomSignal.insert({
      signalId: assertId(args.signalId, 'signalId'),
      roomId: args.roomId,
      fromPeerId: assertId(args.fromPeerId, 'fromPeerId'),
      toPeerId: assertId(args.toPeerId, 'toPeerId'),
      signalKind: args.signalKind,
      payloadJson: args.payloadJson,
      createdAt: ctx.timestamp,
    });
  }
);

export const pruneHostedRooms = spacetimedb.reducer(ctx => {
  const nowMs = Number(ctx.timestamp.toMillis());
  for (const room of ctx.db.hostedRoom.iter()) {
    if (room.status === 'closed' || nowMs - Number(room.lastHeartbeat.toMillis()) > ROOM_TTL_MS) {
      removeRoom(ctx, room.roomId);
    }
  }
  for (const signal of ctx.db.hostedRoomSignal.iter()) {
    if (nowMs - Number(signal.createdAt.toMillis()) > SIGNAL_TTL_MS) {
      ctx.db.hostedRoomSignal.signalId.delete(signal.signalId);
    }
  }
});

function assertRoomShape(room: {
  roomId: string;
  hostPeerId: string;
  name: string;
  rulesetId: string;
  rulesetHash: string;
  contentHash: string;
  mapBundleId: string;
  playerCount: number;
  maxPlayers: number;
  transport: string;
  status: string;
}): void {
  assertId(room.roomId, 'roomId');
  assertId(room.hostPeerId, 'hostPeerId');
  assertHash(room.rulesetHash, 'rulesetHash');
  assertHash(room.contentHash, 'contentHash');
  clampText(room.name, MAX_NAME_LENGTH, 'name');
  clampText(room.rulesetId, MAX_HASH_LENGTH, 'rulesetId');
  clampText(room.mapBundleId, MAX_HASH_LENGTH, 'mapBundleId');
  if (room.transport !== 'webrtc') {
    throw new Error('Only WebRTC rooms are supported');
  }
  assertStatus(room.status);
  if (room.maxPlayers < 1 || room.maxPlayers > 32) {
    throw new Error('maxPlayers must be between 1 and 32');
  }
  if (room.playerCount < 1 || room.playerCount > room.maxPlayers) {
    throw new Error('playerCount must fit the room capacity');
  }
}

function requireOwnedRoom(ctx: ReducerContext, roomId: string): HostedRoomRow {
  const room = requireRoom(ctx, roomId);
  if (!sameIdentity(room.hostIdentity, ctx.sender)) {
    throw new SenderError('Only the room host may change this room');
  }
  return room;
}

function requireOpenRoom(ctx: ReducerContext, roomId: string): HostedRoomRow {
  const room = requireRoom(ctx, roomId);
  if (room.status !== 'open') {
    throw new Error('Room is not open');
  }
  return room;
}

function requireRoom(ctx: ReducerContext, roomId: string): HostedRoomRow {
  const room = ctx.db.hostedRoom.roomId.find(assertId(roomId, 'roomId'));
  if (!room) {
    throw new Error('Room not found');
  }
  return room;
}

function requireMembership(ctx: ReducerContext, roomId: string, peerId: string): HostedRoomPeerRow {
  const membership = ctx.db.hostedRoomPeer.membershipId.find(makeMembershipId(roomId, peerId));
  if (!membership) {
    throw new Error('Peer has not requested this room');
  }
  return membership;
}

function removeRoom(ctx: ReducerContext, roomId: string): void {
  ctx.db.hostedRoom.roomId.delete(roomId);
  ctx.db.hostedRoomPeer.roomId.delete(roomId);
  ctx.db.hostedRoomSignal.roomId.delete(roomId);
}

function assertSignal(kind: string, payloadJson: string): void {
  if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice') {
    throw new Error('Unsupported signal kind');
  }
  if (payloadJson.length === 0 || payloadJson.length > MAX_SIGNAL_PAYLOAD_LENGTH) {
    throw new Error('Signal payload is empty or too large');
  }
  JSON.parse(payloadJson);
}

function assertStatus(status: string): void {
  if (status !== 'open' && status !== 'full' && status !== 'closed') {
    throw new Error('Unsupported room status');
  }
}

function assertHash(value: string, label: string): string {
  return clampText(value, MAX_HASH_LENGTH, label);
}

function assertId(value: string, label: string): string {
  const id = clampText(value, 96, label);
  if (!/^[a-zA-Z0-9:_-]+$/.test(id)) {
    throw new Error(`${label} may only contain letters, numbers, colon, dash, and underscore`);
  }
  return id;
}

function clampText(value: string, maxLength: number, label: string): string {
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new Error(`${label} must be 1-${maxLength} characters`);
  }
  return text;
}

function clampPlayerCount(playerCount: number, maxPlayers: number): number {
  return Math.min(Math.max(1, playerCount), maxPlayers);
}

function makeMembershipId(roomId: string, peerId: string): string {
  return `${assertId(roomId, 'roomId')}:${assertId(peerId, 'peerId')}`;
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.isEqual(right);
}

type ReducerContext = ReducerCtx<typeof spacetimedb.schemaType>;
type HostedRoomRow = NonNullable<ReturnType<ReducerContext['db']['hostedRoom']['roomId']['find']>>;
type HostedRoomPeerRow = NonNullable<ReturnType<ReducerContext['db']['hostedRoomPeer']['membershipId']['find']>>;
