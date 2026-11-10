import type { EngineSnapshot, Ruleset } from '../engine/protocol';
import { validateRuleset } from '../engine/rulesValidation';
import { MAX_SNAPSHOT_FRAME_BYTES, SNAPSHOT_PACKET_BYTES, SnapshotDecoder, SnapshotEncoder } from '../net/snapshotCodec';

export const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
export const MAX_REPLAY_DURATION_MS = 5 * 60_000;
export const MAX_REPLAY_FILE_BYTES = MAX_REPLAY_BYTES + 1024 * 1024 + 12;
const MAX_FRAMES = 10_000;
const MAGIC = new TextEncoder().encode('BEATRPL1');

export type ReplaySource = 'solo' | 'lab' | 'host' | 'client';
export type ReplayDiagnostics = { pendingInputs: number; predictionError: number; snapCorrections: number };
export type ReplayMetadata = { version: 1; ruleset: Ruleset; source: ReplaySource; recordedAt: number; localPlayerId?: string };
export type ReplayFrame = { tick: number; keyframe: boolean; packets: readonly Uint8Array[]; diagnostics?: ReplayDiagnostics };
export type ReplayClip = Readonly<{ metadata: ReplayMetadata; frames: readonly ReplayFrame[]; bytes: number; durationMs: number }>;
type Group = { frames: ReplayFrame[]; bytes: number };

/** An independent baseline chain. Whole checkpoint groups are evicted together. */
export class ReplayRecorder {
  private readonly encoder: SnapshotEncoder;
  private readonly groups: Group[] = [];
  private bytes = 0;
  private lastTick = -Infinity;
  private readonly metadata: ReplayMetadata;

  constructor(metadata: ReplayMetadata, private readonly limits = { maxBytes: MAX_REPLAY_BYTES, maxDurationMs: MAX_REPLAY_DURATION_MS }) {
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > MAX_REPLAY_BYTES ||
        !Number.isFinite(limits.maxDurationMs) || limits.maxDurationMs < 1 || limits.maxDurationMs > MAX_REPLAY_DURATION_MS) throw new Error('Invalid replay recording limits');
    this.metadata = structuredClone(metadata);
    this.encoder = new SnapshotEncoder(metadata.ruleset.arena, Math.max(1, Math.min(metadata.ruleset.tickRate * 2, Math.floor(limits.maxDurationMs / 1000 * metadata.ruleset.tickRate))));
  }

  record(snapshot: EngineSnapshot, diagnostics?: ReplayDiagnostics): boolean {
    if (snapshot.tick - this.lastTick < Math.max(1, Math.ceil(this.metadata.ruleset.tickRate / 30))) return false;
    if (snapshot.rulesetId !== this.metadata.ruleset.id) throw new Error('Replay ruleset changed');
    const current = this.groups.at(-1);
    // Reserve an upper bound for the next frame before encoding: a new
    // checkpoint allows the preceding group to be evicted without breaking ACK dependencies.
    if (current && current.bytes + 2 * MAX_SNAPSHOT_FRAME_BYTES > this.limits.maxBytes) this.encoder.acknowledge(-1);
    const packets = this.encoder.encode(snapshot);
    if (!packets.length) return false;
    const frame: ReplayFrame = { tick: snapshot.tick, keyframe: new DataView(packets[0].buffer).getUint32(8) === 0xffffffff, packets,
      diagnostics: diagnostics ? { ...diagnostics } : undefined };
    const size = frameBytes(frame);
    if (size > this.limits.maxBytes) throw new Error('Snapshot exceeds replay recording budget');
    if (frame.keyframe) this.groups.push({ frames: [], bytes: 0 });
    const group = this.groups.at(-1)!;
    group.frames.push(frame);
    group.bytes += size;
    this.bytes += size;
    this.lastTick = snapshot.tick;
    this.encoder.acknowledge(snapshot.tick);
    while (this.groups.length > 1 && (this.bytes > this.limits.maxBytes ||
      (snapshot.tick - this.groups[0].frames[0].tick) / this.metadata.ruleset.tickRate * 1000 > this.limits.maxDurationMs)) {
      this.bytes -= this.groups.shift()!.bytes;
    }
    return true;
  }

  clip(): ReplayClip | undefined {
    const frames = this.groups.flatMap((group) => group.frames);
    return frames.length ? makeClip(this.metadata, frames, this.bytes) : undefined;
  }
}

export function serializeReplay(clip: ReplayClip): Uint8Array<ArrayBuffer> {
  const metadata = new TextEncoder().encode(JSON.stringify(clip.metadata));
  if (metadata.length > 1024 * 1024) throw new Error('Replay metadata is too large');
  const size = 12 + metadata.length + clip.frames.reduce((sum, frame) => sum + frameBytes(frame), 0);
  if (size > MAX_REPLAY_FILE_BYTES) throw new Error('Replay file is too large');
  const bytes = new Uint8Array(size);
  const data = new DataView(bytes.buffer);
  bytes.set(MAGIC);
  data.setUint32(8, metadata.length, true);
  bytes.set(metadata, 12);
  let offset = 12 + metadata.length;
  for (const frame of clip.frames) {
    data.setUint8(offset++, Number(frame.keyframe) | (frame.diagnostics ? 2 : 0));
    data.setUint32(offset, frame.tick, true); offset += 4;
    data.setUint16(offset, frame.packets.length, true); offset += 2;
    if (frame.diagnostics) {
      data.setUint16(offset, frame.diagnostics.pendingInputs, true); offset += 2;
      data.setFloat64(offset, frame.diagnostics.predictionError, true); offset += 8;
      data.setUint32(offset, frame.diagnostics.snapCorrections, true); offset += 4;
    }
    for (const packet of frame.packets) {
      data.setUint16(offset, packet.length, true); offset += 2;
      bytes.set(packet, offset); offset += packet.length;
    }
  }
  return bytes;
}

/** Decode and validate the entire archive before replacing a visible clip. */
export function parseReplay(buffer: ArrayBuffer): ReplayClip {
  if (buffer.byteLength > MAX_REPLAY_FILE_BYTES) throw new Error('Replay file is too large');
  const reader = new ArchiveReader(buffer);
  if (!reader.take(8).every((byte, i) => byte === MAGIC[i])) throw new Error('Unsupported replay file');
  const metadataLength = reader.u32();
  if (metadataLength > 1024 * 1024) throw new Error('Replay metadata is too large');
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(reader.take(metadataLength)));
  if (!isRecord(raw) || raw.version !== 1 || !['solo', 'lab', 'host', 'client'].includes(String(raw.source)) ||
      typeof raw.recordedAt !== 'number' || !Number.isFinite(raw.recordedAt) ||
      (raw.localPlayerId !== undefined && (typeof raw.localPlayerId !== 'string' || raw.localPlayerId.length > 96))) throw new Error('Invalid replay metadata');
  const metadata: ReplayMetadata = { version: 1, ruleset: validateRuleset(raw.ruleset), source: raw.source as ReplaySource,
    recordedAt: raw.recordedAt, localPlayerId: raw.localPlayerId as string | undefined };
  const decoder = new SnapshotDecoder(metadata.ruleset.arena);
  const frames: ReplayFrame[] = [];
  let bytes = 0, lastTick = -1;
  while (reader.remaining > 0) {
    if (frames.length >= MAX_FRAMES) throw new Error('Replay has too many frames');
    const flags = reader.u8(), tick = reader.u32(), count = reader.u16();
    if (flags > 3 || tick <= lastTick || count < 1 || count > 512 || (!frames.length && !(flags & 1))) throw new Error('Invalid replay frame index');
    const diagnostics = flags & 2 ? { pendingInputs: reader.u16(), predictionError: reader.f64(), snapCorrections: reader.u32() } : undefined;
    if (diagnostics && (diagnostics.pendingInputs > 64 || !Number.isFinite(diagnostics.predictionError) || diagnostics.predictionError < 0)) throw new Error('Invalid replay diagnostics');
    const packets: Uint8Array<ArrayBuffer>[] = [];
    let snapshot: EngineSnapshot | undefined;
    for (let i = 0; i < count; i++) {
      const length = reader.u16();
      if (length < 24 || length > SNAPSHOT_PACKET_BYTES) throw new Error('Invalid replay packet length');
      const packet = reader.take(length).slice();
      const header = new DataView(packet.buffer);
      if (header.getUint32(4) !== tick || (header.getUint32(8) === 0xffffffff) !== Boolean(flags & 1)) throw new Error('Replay packet index mismatch');
      if (header.getUint16(16) !== i || header.getUint16(18) !== count) throw new Error('Invalid replay fragment index');
      if (!(flags & 1) && header.getUint32(8) !== lastTick) throw new Error('Replay baseline must be the preceding recorded frame');
      packets.push(packet);
      snapshot = decoder.receive(packet.buffer, 0).snapshot ?? snapshot;
    }
    if (!snapshot || snapshot.rulesetId !== metadata.ruleset.id || snapshot.tick !== tick) throw new Error('Invalid replay snapshot');
    validateGeometry(snapshot);
    const frame = { tick, keyframe: Boolean(flags & 1), packets, diagnostics };
    bytes += frameBytes(frame);
    if (bytes > MAX_REPLAY_BYTES || (tick - (frames[0]?.tick ?? tick)) / metadata.ruleset.tickRate * 1000 > MAX_REPLAY_DURATION_MS) throw new Error('Replay exceeds retention limits');
    frames.push(frame);
    lastTick = tick;
  }
  if (!frames.length) throw new Error('Replay is empty');
  return makeClip(metadata, frames, bytes);
}

function frameBytes(frame: ReplayFrame): number {
  return 7 + (frame.diagnostics ? 14 : 0) + frame.packets.reduce((sum, packet) => sum + 2 + packet.length, 0);
}
function makeClip(metadata: ReplayMetadata, frames: readonly ReplayFrame[], bytes: number): ReplayClip {
  return { metadata, frames, bytes, durationMs: (frames.at(-1)!.tick - frames[0].tick) / metadata.ruleset.tickRate * 1000 };
}
function validateGeometry(snapshot: EngineSnapshot): void {
  for (const entity of [...snapshot.objectives, ...snapshot.objectives.flatMap((objective) => objective.zones), ...snapshot.projectiles, ...snapshot.physicsBodies, ...snapshot.effects]) {
    if (entity.radius < 0 || entity.radius > 1_000_000) throw new Error('Invalid replay radius');
  }
  for (const effect of [...snapshot.effects, ...snapshot.combatTexts]) {
    if (effect.lifetimeTicks <= 0 || effect.ageTicks < 0) throw new Error('Invalid replay effect lifetime');
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

class ArchiveReader {
  private offset = 0;
  private readonly data: DataView;
  constructor(private readonly buffer: ArrayBuffer) { this.data = new DataView(buffer); }
  get remaining(): number { return this.buffer.byteLength - this.offset; }
  take(length: number): Uint8Array<ArrayBuffer> {
    if (length > this.remaining) throw new Error('Truncated replay file');
    const result = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return result;
  }
  u8(): number { const value = this.data.getUint8(this.offset); this.offset++; return value; }
  u16(): number { const value = this.data.getUint16(this.offset, true); this.offset += 2; return value; }
  u32(): number { const value = this.data.getUint32(this.offset, true); this.offset += 4; return value; }
  f64(): number { const value = this.data.getFloat64(this.offset, true); this.offset += 8; return value; }
}
