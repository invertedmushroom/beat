import type { EngineSnapshot, Ruleset } from '../engine/protocol';
import { fromNetworkSnapshot, isNetworkSnapshot, toNetworkSnapshot } from './compactSnapshot';
import { decodeSnapshotPatch, encodeSnapshotPatch, type Value } from './snapshotBinary';

export const SNAPSHOT_PACKET_BYTES = 1_000;
const HEADER_BYTES = 24;
const CHUNK_BYTES = SNAPSHOT_PACKET_BYTES - HEADER_BYTES;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_HISTORY = 64;
const NO_BASELINE = 0xffffffff;
const MAGIC = 0x4253;
type Arena = Ruleset['arena'];

export function quantizePosition(value: number, extent: number): number {
  return Math.round(Math.max(0, Math.min(1, value / extent + 0.5)) * 65535);
}

export function dequantizePosition(value: number, extent: number): number {
  return (value / 65535 - 0.5) * extent;
}

function positions(value: Value, arena: Arena, decode = false, key = ''): Value {
  if (typeof value === 'number' && ['x', 'y', 'anchorX', 'anchorY'].includes(key)) {
    const extent = key === 'x' || key === 'anchorX' ? arena.width : arena.height;
    return decode ? dequantizePosition(value, extent) : quantizePosition(value, extent);
  }
  if (Array.isArray(value)) return value.map((entry) => positions(entry, arena, decode));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, positions(entry, arena, decode, field)]));
  }
  return value;
}

function checksum(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}

function remember(history: Map<number, Value>, tick: number, value: Value): void {
  history.set(tick, value);
  while (history.size > MAX_HISTORY) history.delete(history.keys().next().value!);
}

/** One instance per transport peer; only an acknowledged, actually sent frame is a baseline. */
export class SnapshotEncoder {
  private readonly history = new Map<number, Value>();
  private ackedTick = NO_BASELINE;
  private lastKeyframeTick = -Infinity;
  private lastEncodedTick = -1;

  constructor(private readonly arena: Arena, private readonly keyframeTicks: number) {}

  acknowledge(tick: number): void {
    if (tick === -1) { this.ackedTick = NO_BASELINE; return; }
    if (this.history.has(tick) && (this.ackedTick === NO_BASELINE || tick > this.ackedTick)) this.ackedTick = tick;
  }

  encode(snapshot: EngineSnapshot): Uint8Array[] {
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0 || snapshot.tick >= NO_BASELINE) throw new Error('Snapshot tick out of range');
    // Tick IDs are immutable baseline identities, including while paused.
    if (snapshot.tick <= this.lastEncodedTick) return [];
    const keyframe = snapshot.tick - this.lastKeyframeTick >= this.keyframeTicks;
    const baseline = keyframe ? undefined : this.history.get(this.ackedTick);
    const baseTick = baseline === undefined ? NO_BASELINE : this.ackedTick;
    const value = positions(toNetworkSnapshot(snapshot) as unknown as Value, this.arena);
    const bytes = encodeSnapshotPatch(value, baseline);
    if (bytes.length > MAX_FRAME_BYTES) throw new Error('Snapshot exceeds frame budget');
    const count = Math.ceil(bytes.length / CHUNK_BYTES);
    const hash = checksum(bytes);
    const packets = Array.from({ length: count }, (_, index) => {
      const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      const packet = new Uint8Array(HEADER_BYTES + chunk.length);
      const header = new DataView(packet.buffer);
      header.setUint16(0, MAGIC);
      header.setUint8(2, 1);
      header.setUint32(4, snapshot.tick);
      header.setUint32(8, baseTick);
      header.setUint32(12, bytes.length);
      header.setUint16(16, index);
      header.setUint16(18, count);
      header.setUint32(20, hash);
      packet.set(chunk, HEADER_BYTES);
      return packet;
    });
    remember(this.history, snapshot.tick, value);
    this.lastEncodedTick = snapshot.tick;
    if (baseTick === NO_BASELINE) this.lastKeyframeTick = snapshot.tick;
    return packets;
  }
}

type Assembly = { tick: number; base: number; size: number; hash: number; createdAt: number; chunks: Map<number, Uint8Array> };
export type SnapshotDecodeResult = { snapshot?: EngineSnapshot; ackTick?: number; needsKeyframe?: boolean };

export class SnapshotDecoder {
  private readonly history = new Map<number, Value>();
  private readonly pending = new Map<number, Assembly>();
  private latestTick = -1;

  constructor(private readonly arena: Arena) {}

  receive(packet: ArrayBuffer, nowMs = performance.now()): SnapshotDecodeResult {
    if (packet.byteLength < HEADER_BYTES || packet.byteLength > SNAPSHOT_PACKET_BYTES) return {};
    const header = new DataView(packet);
    if (header.getUint16(0) !== MAGIC || header.getUint8(2) !== 1 || header.getUint8(3) !== 0) return {};
    const tick = header.getUint32(4), base = header.getUint32(8), size = header.getUint32(12);
    const index = header.getUint16(16), count = header.getUint16(18), hash = header.getUint32(20);
    if (tick === NO_BASELINE || tick <= this.latestTick || (base !== NO_BASELINE && base >= tick)) return {};
    if (size < 1 || size > MAX_FRAME_BYTES || count !== Math.ceil(size / CHUNK_BYTES) || index >= count) return {};
    if (packet.byteLength - HEADER_BYTES !== Math.min(CHUNK_BYTES, size - index * CHUNK_BYTES)) return {};
    for (const [id, frame] of this.pending) if (nowMs - frame.createdAt > 1_000) this.pending.delete(id);
    let frame = this.pending.get(tick);
    if (!frame) {
      while (this.pending.size >= 4) this.pending.delete(this.pending.keys().next().value!);
      frame = { tick, base, size, hash, createdAt: nowMs, chunks: new Map() };
      this.pending.set(tick, frame);
    }
    if (frame.base !== base || frame.size !== size || frame.hash !== hash) return {};
    frame.chunks.set(index, new Uint8Array(packet.slice(HEADER_BYTES)));
    if (frame.chunks.size !== count) return {};
    this.pending.delete(tick);
    const baseline = this.history.get(base);
    if (base !== NO_BASELINE && baseline === undefined) return { needsKeyframe: true };
    const bytes = new Uint8Array(size);
    for (const [part, chunk] of frame.chunks) bytes.set(chunk, part * CHUNK_BYTES);
    if (checksum(bytes) !== hash) return {};
    try {
      const value = decodeSnapshotPatch(bytes, baseline);
      const decoded = positions(value, this.arena, true);
      if (!isNetworkSnapshot(decoded) || decoded.tick !== tick) return {};
      remember(this.history, tick, value);
      this.latestTick = tick;
      for (const id of this.pending.keys()) if (id <= tick) this.pending.delete(id);
      return { snapshot: fromNetworkSnapshot(decoded), ackTick: tick };
    } catch {
      return {};
    }
  }
}
