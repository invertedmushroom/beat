// The fixed dictionary keeps field names out of routine snapshots. Unknown keys
// are still encoded as strings so adding a snapshot field cannot silently drop it.
const KEYS = ('tick nowMs rulesetId match objectives players projectiles physicsBodies constraints effects combatTexts ' +
  'elapsedTicks remainingTicks durationTicks scoreLimit finished winnerTeamId teams id name color score objectiveId kind bodyId ' +
  'x y vx vy radius activeZoneId lastScoredTeamId scoreCooldownTicks zones controllingTeamId contestProgress zoneId team points ' +
  'playerId displayName hue hp maxHp alive respawnTick slotCooldownTicks lastUsedSlot aimDx aimDy facingDx facingDy role status statuses resources charging lastInputSequence ' +
  'slowMultiplier slowTicks slowColor tags stacks movementMultiplier damageDealtMultiplier damageTakenMultiplier value max ' +
  'slot abilityId chargeTicks maxTicks ratio projectileId ownerId effectId ageTicks lifetimeTicks sourceAbilityId constraintId targetId ' +
  'anchorBodyId anchorX anchorY length textId amount').split(' ');
const KEY_IDS = new Map(KEYS.map((key, index) => [key, index + 1]));
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type Value = null | undefined | boolean | number | string | Value[] | { [key: string]: Value };
const enum Tag { Same, Null, False, True, Int, Float, String, Array, Object, Undefined, U16, ObjectDelta, ArrayDelta }
const MAX_ITEMS = 16_384;
const MAX_DEPTH = 24;

export function encodeSnapshotPatch(value: Value, baseline?: Value): Uint8Array {
  return patch(value, baseline, '').finish();
}

export function decodeSnapshotPatch(bytes: Uint8Array, baseline?: Value): Value {
  const reader = new Reader(bytes);
  const result = reader.value(baseline, 0);
  if (reader.offset !== bytes.length) throw new Error('Trailing snapshot bytes');
  return result;
}

function patch(value: Value, baseline: Value, key: string): Writer {
  const writer = new Writer();
  if (Object.is(value, baseline)) return writer.byte(Tag.Same);
  if (Array.isArray(value) && Array.isArray(baseline)) {
    const entries = value.map((entry, index) => [index, patch(entry, baseline[index], '')] as const)
      .filter(([, entry]) => !entry.same());
    if (entries.length === 0 && value.length === baseline.length) return writer.byte(Tag.Same);
    writer.byte(Tag.ArrayDelta).uint(value.length).uint(entries.length);
    for (const [index, entry] of entries) writer.uint(index).append(entry);
    return writer;
  }
  if (isObject(value) && isObject(baseline)) {
    const entries = [...new Set([...Object.keys(value), ...Object.keys(baseline)])]
      .map((field) => [field, patch(value[field], baseline[field], field)] as const)
      .filter(([, entry]) => !entry.same());
    if (entries.length === 0) return writer.byte(Tag.Same);
    writer.byte(Tag.ObjectDelta).uint(entries.length);
    for (const [field, entry] of entries) writer.key(field).append(entry);
    return writer;
  }
  writer.value(value, key);
  return writer;
}

function isObject(value: Value): value is { [key: string]: Value } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class Writer {
  private bytes: number[] = [];
  byte(value: number): this { this.bytes.push(value); return this; }
  uint(value: number): this {
    do { const low = value % 128; value = Math.floor(value / 128); this.byte(low | (value > 0 ? 128 : 0)); } while (value > 0);
    return this;
  }
  string(value: string): this {
    const bytes = encoder.encode(value);
    this.uint(bytes.length);
    for (const byte of bytes) this.byte(byte);
    return this;
  }
  key(value: string): this {
    const id = KEY_IDS.get(value);
    this.uint(id ?? 0);
    if (!id) this.string(value);
    return this;
  }
  value(value: Value, key: string): void {
    if (value === undefined) { this.byte(Tag.Undefined); return; }
    if (value === null) { this.byte(Tag.Null); return; }
    if (typeof value === 'boolean') { this.byte(value ? Tag.True : Tag.False); return; }
    if (typeof value === 'number') {
      if (key === 'x' || key === 'y' || key === 'anchorX' || key === 'anchorY') {
        this.byte(Tag.U16).byte(value & 255).byte(value >>> 8);
      } else if (Number.isSafeInteger(value) && Math.abs(value) < 0x40000000) {
        this.byte(Tag.Int).uint(value >= 0 ? value * 2 : -value * 2 - 1);
      } else {
        const data = new DataView(new ArrayBuffer(8));
        data.setFloat64(0, value, true);
        this.byte(Tag.Float);
        for (let i = 0; i < 8; i++) this.byte(data.getUint8(i));
      }
      return;
    }
    if (typeof value === 'string') { this.byte(Tag.String).string(value); return; }
    if (Array.isArray(value)) {
      this.byte(Tag.Array).uint(value.length);
      for (const entry of value) this.value(entry, '');
      return;
    }
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    this.byte(Tag.Object).uint(entries.length);
    for (const [field, entry] of entries) { this.key(field); this.value(entry, field); }
  }
  append(other: Writer): this { for (const byte of other.bytes) this.byte(byte); return this; }
  same(): boolean { return this.bytes.length === 1 && this.bytes[0] === Tag.Same; }
  finish(): Uint8Array { return Uint8Array.from(this.bytes); }
}

class Reader {
  offset = 0;
  private budget = 100_000;
  constructor(private readonly bytes: Uint8Array) {}
  private byte(): number {
    if (this.offset >= this.bytes.length) throw new Error('Truncated snapshot');
    return this.bytes[this.offset++];
  }
  private uint(): number {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid snapshot integer');
  }
  private count(): number {
    const count = this.uint();
    if (count > MAX_ITEMS) throw new Error('Snapshot collection too large');
    return count;
  }
  private string(): string {
    const size = this.count();
    if (size > this.bytes.length - this.offset) throw new Error('Truncated snapshot string');
    const value = decoder.decode(this.bytes.subarray(this.offset, this.offset + size));
    this.offset += size;
    return value;
  }
  private key(): string {
    const id = this.uint();
    const key = id === 0 ? this.string() : KEYS[id - 1];
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid snapshot field');
    return key;
  }
  value(baseline: Value, depth: number): Value {
    if (depth > MAX_DEPTH || --this.budget < 0) throw new Error('Snapshot nesting too deep');
    const tag = this.byte();
    switch (tag) {
      case Tag.Same: return baseline;
      case Tag.Null: return null;
      case Tag.Undefined: return undefined;
      case Tag.False: return false;
      case Tag.True: return true;
      case Tag.Int: { const value = this.uint(); return value % 2 === 0 ? value / 2 : -(value + 1) / 2; }
      case Tag.U16: return this.byte() + this.byte() * 256;
      case Tag.Float: {
        const buffer = new ArrayBuffer(8);
        const data = new DataView(buffer);
        for (let i = 0; i < 8; i++) data.setUint8(i, this.byte());
        const value = data.getFloat64(0, true);
        if (!Number.isFinite(value)) throw new Error('Non-finite snapshot number');
        return value;
      }
      case Tag.String: return this.string();
      case Tag.Array: return Array.from({ length: this.count() }, () => this.value(undefined, depth + 1));
      case Tag.Object:
      case Tag.ObjectDelta: {
        if (tag === Tag.ObjectDelta && !isObject(baseline)) throw new Error('Invalid object baseline');
        const result: { [key: string]: Value } = tag === Tag.ObjectDelta ? { ...baseline as object } : {};
        const count = this.count();
        const keys = new Set<string>();
        for (let i = 0; i < count; i++) {
          const key = this.key();
          if (keys.has(key)) throw new Error('Duplicate snapshot field');
          keys.add(key);
          const value = this.value(result[key], depth + 1);
          if (value === undefined) delete result[key];
          else result[key] = value;
        }
        return result;
      }
      case Tag.ArrayDelta: {
        if (!Array.isArray(baseline)) throw new Error('Invalid array baseline');
        const length = this.count();
        const count = this.count();
        const result = baseline.slice(0, length);
        result.length = length;
        let previous = -1;
        for (let i = 0; i < count; i++) {
          const index = this.uint();
          if (index >= length || index <= previous) throw new Error('Invalid snapshot array index');
          previous = index;
          result[index] = this.value(result[index], depth + 1);
        }
        return result;
      }
      default: throw new Error('Unknown snapshot tag');
    }
  }
}
