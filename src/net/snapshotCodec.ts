import type { EngineSnapshot, Ruleset } from '../engine/protocol';
import { fromNetworkSnapshot, isNetworkSnapshot, toNetworkSnapshot } from './compactSnapshot';
import { decodeSnapshotPatch, SnapshotPatchWriter, type Value } from './snapshotBinary';

export const SNAPSHOT_PACKET_BYTES = 1_000;
const HEADER_BYTES = 24;
const CHUNK_BYTES = SNAPSHOT_PACKET_BYTES - HEADER_BYTES;
export const MAX_SNAPSHOT_FRAME_BYTES = 256 * 1024;
const MAX_HISTORY = 64;
const NO_BASELINE = 0xffffffff;
const MAGIC = 0x4253;
type Arena = Ruleset['arena'];
export type PreparedSnapshot = Readonly<{ tick: number; value: Value }>;
export type SnapshotFrame = { tick: number; keyframe: boolean; packets: Uint8Array[] };

/** One immutable quantized tree shared by every peer. Lazy for throttled ticks. */
export function prepareSnapshot(snapshot: EngineSnapshot, arena: Arena): PreparedSnapshot {
  let value: Value;
  return { tick: snapshot.tick, get value() { return value ??= positions(toNetworkSnapshot(snapshot) as unknown as Value, arena); } };
}

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

function remember(history: Map<number, Value>, tick: number, value: Value, pinned = NO_BASELINE): void {
  history.set(tick, value);
  for (const id of history.keys()) {
    if (history.size <= MAX_HISTORY) break;
    if (id !== pinned) history.delete(id);
  }
}

/** One instance per transport peer; only an acknowledged, actually sent frame is a baseline. */
export class SnapshotEncoder {
  private readonly history = new Map<number, Value>();
  private ackedTick = NO_BASELINE;
  private lastKeyframeTick = -Infinity;
  private lastEncodedTick = -1;
  private readonly writer = new SnapshotPatchWriter();

  constructor(private readonly arena: Arena, private readonly keyframeTicks: number, readonly version: 1 | 2 = 2) {}

  acknowledge(tick: number): boolean {
    if (tick === -1) { this.ackedTick = NO_BASELINE; return true; }
    if (!this.history.has(tick)) return false;
    if (this.ackedTick === NO_BASELINE || tick > this.ackedTick) this.ackedTick = tick;
    return true;
  }

  encode(snapshot: EngineSnapshot): Uint8Array[] {
    return this.encodePrepared(prepareSnapshot(snapshot, this.arena))?.packets ?? [];
  }

  encodePrepared(snapshot: PreparedSnapshot, keyframesAvailable = true): SnapshotFrame | undefined {
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0 || snapshot.tick >= NO_BASELINE) throw new Error('Snapshot tick out of range');
    // Tick IDs are immutable baseline identities, including while paused.
    if (snapshot.tick <= this.lastEncodedTick) return undefined;
    const keyframe = keyframesAvailable && snapshot.tick - this.lastKeyframeTick >= this.keyframeTicks;
    const baseline = keyframe ? undefined : this.history.get(this.ackedTick);
    if (baseline === undefined && !keyframesAvailable) return undefined;
    const baseTick = baseline === undefined ? NO_BASELINE : this.ackedTick;
    const value = snapshot.value;
    const bytes = this.writer.encode(value, baseline, this.version);
    if (bytes.length > MAX_SNAPSHOT_FRAME_BYTES) throw new Error('Snapshot exceeds frame budget');
    const count = Math.ceil(bytes.length / CHUNK_BYTES);
    const hash = checksum(bytes);
    const packets = Array.from({ length: count }, (_, index) => {
      const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      const packet = new Uint8Array(HEADER_BYTES + chunk.length);
      const header = new DataView(packet.buffer);
      header.setUint16(0, MAGIC);
      header.setUint8(2, this.version);
      header.setUint32(4, snapshot.tick);
      header.setUint32(8, baseTick);
      header.setUint32(12, bytes.length);
      header.setUint16(16, index);
      header.setUint16(18, count);
      header.setUint32(20, hash);
      packet.set(chunk, HEADER_BYTES);
      return packet;
    });
    remember(this.history, snapshot.tick, value, this.ackedTick);
    this.lastEncodedTick = snapshot.tick;
    if (baseTick === NO_BASELINE) this.lastKeyframeTick = snapshot.tick;
    return { tick: snapshot.tick, keyframe: baseTick === NO_BASELINE, packets };
  }
}

type Assembly = { tick: number; base: number; size: number; hash: number; version: number; createdAt: number; chunks: Map<number, Uint8Array> };
export type SnapshotDecodeResult = { snapshot?: EngineSnapshot; ackTick?: number; needsKeyframe?: boolean };

export class SnapshotDecoder {
  private readonly history = new Map<number, Value>();
  private readonly pending = new Map<number, Assembly>();
  private latestTick = -1;
  private reliableFrame?: Assembly;
  private referencedBaseline = NO_BASELINE;

  constructor(private readonly arena: Arena) {}

  receive(packet: ArrayBuffer, nowMs = performance.now(), reliable = false): SnapshotDecodeResult {
    if (packet.byteLength < HEADER_BYTES || packet.byteLength > SNAPSHOT_PACKET_BYTES) return {};
    const header = new DataView(packet);
    const version = header.getUint8(2);
    if (header.getUint16(0) !== MAGIC || (version !== 1 && version !== 2) || header.getUint8(3) !== 0) return {};
    const tick = header.getUint32(4), base = header.getUint32(8), size = header.getUint32(12);
    const index = header.getUint16(16), count = header.getUint16(18), hash = header.getUint32(20);
    if (tick === NO_BASELINE || tick <= this.latestTick || (base !== NO_BASELINE && base >= tick)) return {};
    if (size < 1 || size > MAX_SNAPSHOT_FRAME_BYTES || count !== Math.ceil(size / CHUNK_BYTES) || index >= count) return {};
    if (packet.byteLength - HEADER_BYTES !== Math.min(CHUNK_BYTES, size - index * CHUNK_BYTES)) return {};
    if (reliable && base !== NO_BASELINE) return {};
    for (const [id, frame] of this.pending) if (nowMs - frame.createdAt > 1_000) this.pending.delete(id);
    let frame = reliable ? this.reliableFrame : this.pending.get(tick);
    if (reliable && frame && (nowMs - frame.createdAt > 15_000 || frame.tick !== tick)) frame = undefined;
    if (!frame) {
      frame = { tick, base, size, hash, version, createdAt: nowMs, chunks: new Map() };
      if (reliable) this.reliableFrame = frame;
      else {
        while (this.pending.size >= 4) this.pending.delete(this.pending.keys().next().value!);
        this.pending.set(tick, frame);
      }
    }
    if (frame.base !== base || frame.size !== size || frame.hash !== hash || frame.version !== version) return {};
    frame.chunks.set(index, new Uint8Array(packet.slice(HEADER_BYTES)));
    if (frame.chunks.size !== count) return {};
    if (reliable) this.reliableFrame = undefined;
    else this.pending.delete(tick);
    const baseline = this.history.get(base);
    if (base !== NO_BASELINE && baseline === undefined) return { needsKeyframe: true };
    const bytes = new Uint8Array(size);
    for (const [part, chunk] of frame.chunks) bytes.set(chunk, part * CHUNK_BYTES);
    if (checksum(bytes) !== hash) return {};
    try {
      const value = decodeSnapshotPatch(bytes, baseline, version);
      const decoded = positions(value, this.arena, true);
      if (!isNetworkSnapshot(decoded) || decoded.tick !== tick) return {};
      if (base !== NO_BASELINE) this.referencedBaseline = base;
      remember(this.history, tick, value, this.referencedBaseline);
      this.latestTick = tick;
      for (const id of this.pending.keys()) if (id <= tick) this.pending.delete(id);
      return { snapshot: fromNetworkSnapshot(decoded), ackTick: tick };
    } catch {
      return {};
    }
  }
}
