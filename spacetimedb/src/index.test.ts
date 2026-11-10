import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ scheduled: [] as Array<() => (ctx: unknown) => void>, connected: [] as Array<(ctx: unknown) => void> }));
vi.mock('spacetimedb/server', () => {
  const column = new Proxy({}, { get: () => () => column });
  return {
    t: new Proxy({}, { get: () => () => column }),
    table: (options: { scheduled?: () => (ctx: unknown) => void }, fields: unknown) => {
      if (options.scheduled) sdk.scheduled.push(options.scheduled);
      return { rowType: fields };
    },
    SenderError: Error,
    schema: () => ({
      schemaType: {},
      init: (callback: (ctx: unknown) => void) => callback,
      clientConnected: (callback: (ctx: unknown) => void) => { sdk.connected.push(callback); return callback; },
      reducer: (...args: unknown[]) => {
        const callback = args[args.length - 1] as (ctx: unknown) => void;
        return callback;
      },
    }),
  };
});
import * as directory from './index';

const timestamp = (ms: number) => ({ toMillis: () => BigInt(ms) });
type Row = { roomId: string; [key: string]: unknown };

function context() {
  const rooms = new Map<string, Row>([
    ['stale', { roomId: 'stale', status: 'open', lastHeartbeat: timestamp(1) }],
    ['live', { roomId: 'live', status: 'open', lastHeartbeat: timestamp(20_000) }],
  ]);
  const peers = new Map<string, Row>([
    ['stale-peer', { membershipId: 'stale-peer', roomId: 'stale', state: 'accepted', updatedAt: timestamp(1) }],
    ['live-peer', { membershipId: 'live-peer', roomId: 'live', state: 'accepted', updatedAt: timestamp(1) }],
    ['orphan', { membershipId: 'orphan', roomId: 'missing', state: 'accepted', updatedAt: timestamp(1) }],
    ['old-request', { membershipId: 'old-request', roomId: 'live', state: 'pending', updatedAt: timestamp(-100_000) }],
    ['recent-request', { membershipId: 'recent-request', roomId: 'live', state: 'pending', updatedAt: timestamp(19_000) }],
  ]);
  const signals = new Map<string, Row>([
    ['expired', { signalId: 'expired', roomId: 'live', createdAt: timestamp(-200_000) }],
    ['live-signal', { signalId: 'live-signal', roomId: 'live', createdAt: timestamp(20_000) }],
  ]);
  function table(rows: Map<string, Row>, primary: string) {
    return {
      iter: () => [...rows.values()],
      [primary]: { find: (id: string) => rows.get(id), delete: (id: string) => rows.delete(id) },
      roomId: primary === 'roomId' ? { find: (id: string) => rows.get(id), delete: (id: string) => rows.delete(id) } : {
        delete: (roomId: string) => { for (const [id, row] of rows) if (row.roomId === roomId) rows.delete(id); },
      },
    };
  }
  const sweepRows: unknown[] = [];
  const ctx = { timestamp: timestamp(20_000), db: {
    hostedRoom: table(rooms, 'roomId'), hostedRoomPeer: table(peers, 'membershipId'), hostedRoomSignal: table(signals, 'signalId'),
    hostedRoomSweep: { sweepId: { find: () => sweepRows[0] }, insert: (row: unknown) => sweepRows.push(row) },
  } };
  return { ctx, rooms, peers, signals, sweepRows };
}

describe('autonomous directory expiry', () => {
  it('registers an interval sweep that cleans stale and orphan rows without a browser pruning call', () => {
    const state = context();
    expect(sdk.scheduled).toHaveLength(1);
    sdk.scheduled[0]()(state.ctx);
    expect([...state.rooms.keys()]).toEqual(['live']);
    expect([...state.peers.keys()]).toEqual(['live-peer', 'recent-request']);
    expect([...state.signals.keys()]).toEqual(['live-signal']);
  });

  it('seeds the sweep once on init and on connection for an existing database upgrade', () => {
    const state = context();
    expect(sdk.connected).toHaveLength(1);
    sdk.connected[0](state.ctx);
    sdk.connected[0](state.ctx);
    (directory.init as unknown as (ctx: unknown) => void)(state.ctx);
    expect(state.sweepRows).toHaveLength(1);
  });

  it('rejects a stale room join before the next sweep executes', () => {
    const state = context();
    const join = directory.requestJoinHostedRoom as unknown as (ctx: unknown, args: { roomId: string; peerId: string; displayName: string }) => void;
    expect(() => join(state.ctx, { roomId: 'stale', peerId: 'joining', displayName: 'Player' })).toThrow('expired');
  });
});
