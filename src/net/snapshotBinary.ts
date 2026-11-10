// The fixed dictionary keeps field names out of routine snapshots. Unknown keys
// are still encoded as strings so adding a snapshot field cannot silently drop it.
const LEGACY_KEYS = ('tick nowMs rulesetId match objectives players projectiles physicsBodies constraints effects combatTexts ' +
  'elapsedTicks remainingTicks durationTicks scoreLimit finished winnerTeamId teams id name color score objectiveId kind bodyId ' +
  'x y vx vy radius activeZoneId lastScoredTeamId scoreCooldownTicks zones controllingTeamId contestProgress zoneId team points ' +
  'playerId displayName hue hp maxHp alive respawnTick slotCooldownTicks lastUsedSlot aimDx aimDy facingDx facingDy role status statuses resources charging lastInputSequence ' +
  'slowMultiplier slowTicks slowColor tags stacks movementMultiplier damageDealtMultiplier damageTakenMultiplier value max ' +
  'slot abilityId chargeTicks maxTicks ratio projectileId ownerId effectId ageTicks lifetimeTicks sourceAbilityId constraintId targetId ' +
  'anchorBodyId anchorX anchorY length textId amount').split(' ');
// V2 appends jumpHeld as ID 88. V1 keeps the literal field name.
const KEYS = [...LEGACY_KEYS, 'jumpHeld'];
const KEY_IDS = new Map(KEYS.map((key, index) => [key, index + 1]));
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type Value = null | undefined | boolean | number | string | Value[] | { [key: string]: Value };
const enum Tag { Same, Null, False, True, Int, Float, String, Array, Object, Undefined, U16, ObjectDelta, ArrayDelta, KeyedArrayDelta }
const MAX_ITEMS = 16_384;
const MAX_DEPTH = 24;
const MAX_BYTES = 256 * 1024;
const ENTITY_KEYS: Record<string, string> = { players: 'playerId', projectiles: 'projectileId', effects: 'effectId', combatTexts: 'textId',
  physicsBodies: 'bodyId', constraints: 'constraintId', objectives: 'objectiveId', zones: 'zoneId', statuses: 'id', resources: 'id', teams: 'id' };
const indices = new WeakMap<Value[], Map<string, number> | null>();

export function encodeSnapshotPatch(value: Value, baseline?: Value): Uint8Array {
  return new SnapshotPatchWriter().encode(value, baseline).slice();
}

export function decodeSnapshotPatch(bytes: Uint8Array, baseline?: Value, version = 2): Value {
  const reader = new Reader(bytes, version);
  const result = reader.value(baseline, 0);
  if (reader.offset !== bytes.length) throw new Error('Trailing snapshot bytes');
  return result;
}

function isObject(value: Value): value is { [key: string]: Value } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entityIndex(values: Value[], key: string): Map<string, number> | null {
  const cached = indices.get(values);
  if (cached !== undefined) return cached;
  const result = new Map<string, number>();
  for (let i = 0; i < values.length; i++) {
    const entry = values[i];
    if (!isObject(entry) || typeof entry[key] !== 'string' || result.has(entry[key])) { indices.set(values, null); return null; }
    result.set(entry[key], i);
  }
  indices.set(values, result);
  return result;
}

/** Reused per peer. The returned view is borrowed until the next encode call. */
export class SnapshotPatchWriter {
  private bytes = new Uint8Array(4096);
  private data = new DataView(this.bytes.buffer);
  private offset = 0;
  private version = 2;

  encode(value: Value, baseline?: Value, version = 2): Uint8Array {
    this.offset = 0;
    this.version = version;
    this.patch(value, baseline, '');
    return this.bytes.subarray(0, this.offset);
  }

  private ensure(size: number): void {
    const needed = this.offset + size;
    if (needed > MAX_BYTES) throw new Error('Snapshot exceeds frame budget');
    if (needed <= this.bytes.length) return;
    const grown = new Uint8Array(Math.min(MAX_BYTES, Math.max(needed, this.bytes.length * 2)));
    grown.set(this.bytes);
    this.bytes = grown;
    this.data = new DataView(grown.buffer);
  }
  private byte(value: number): void { this.ensure(1); this.bytes[this.offset++] = value; }
  private uint(value: number): void {
    do { const low = value % 128; value = Math.floor(value / 128); this.byte(low | (value > 0 ? 128 : 0)); } while (value > 0);
  }
  private reserveCount(): number { this.ensure(5); const at = this.offset; this.offset += 5; return at; }
  private finishCount(at: number, count: number): void {
    const end = this.offset;
    this.offset = at;
    this.uint(count);
    const countEnd = this.offset;
    this.bytes.copyWithin(countEnd, at + 5, end);
    this.offset = end - (at + 5 - countEnd);
  }
  private string(value: string): void {
    const at = this.reserveCount();
    this.ensure(value.length * 3);
    const { written } = encoder.encodeInto(value, this.bytes.subarray(this.offset));
    this.offset += written;
    this.finishCount(at, written);
  }
  private key(value: string): void {
    const candidate = KEY_IDS.get(value);
    const id = candidate !== undefined && (candidate <= LEGACY_KEYS.length || this.version >= 2) ? candidate : 0;
    this.uint(id ?? 0);
    if (!id) this.string(value);
  }

  private patch(value: Value, baseline: Value, key: string): boolean {
    const start = this.offset;
    if (Object.is(value, baseline)) { this.byte(Tag.Same); return false; }
    if (Array.isArray(value) && Array.isArray(baseline)) {
      const entityKey = ENTITY_KEYS[key];
      if (this.version >= 2 && entityKey && entityIndex(value, entityKey) && entityIndex(baseline, entityKey)) {
        return this.keyedArray(value, baseline, entityKey);
      }
      this.byte(Tag.ArrayDelta);
      this.uint(value.length);
      const at = this.reserveCount();
      let count = 0;
      for (let i = 0; i < value.length; i++) {
        const entryStart = this.offset;
        this.uint(i);
        if (this.patch(value[i], baseline[i], '')) count++;
        else this.offset = entryStart;
      }
      if (count === 0 && value.length === baseline.length) { this.offset = start; this.byte(Tag.Same); return false; }
      this.finishCount(at, count);
      return true;
    }
    if (isObject(value) && isObject(baseline)) {
      this.byte(Tag.ObjectDelta);
      const at = this.reserveCount();
      let count = 0;
      for (const field in value) {
        if (!Object.hasOwn(value, field)) continue;
        const entryStart = this.offset;
        this.key(field);
        if (this.patch(value[field], baseline[field], field)) count++;
        else this.offset = entryStart;
      }
      for (const field in baseline) {
        if (!Object.hasOwn(baseline, field) || Object.hasOwn(value, field) || baseline[field] === undefined) continue;
        this.key(field);
        this.byte(Tag.Undefined);
        count++;
      }
      if (count === 0) { this.offset = start; this.byte(Tag.Same); return false; }
      this.finishCount(at, count);
      return true;
    }
    this.value(value, key);
    return true;
  }

  private keyedArray(value: Value[], baseline: Value[], idKey: string): boolean {
    const start = this.offset;
    const oldIds = entityIndex(baseline, idKey)!;
    const oldIndex = (i: number) => oldIds.get((value[i] as Record<string, Value>)[idKey] as string) ?? -1;
    this.byte(Tag.KeyedArrayDelta);
    this.uint(value.length);
    const runsAt = this.reserveCount();
    let runs = 0, sameOrder = value.length === baseline.length;
    // Contiguous baseline runs make a head despawn constant-size, preserving
    // exact order even when a collection is reordered or new entities inserted.
    for (let i = 0; i < value.length;) {
      const base = oldIndex(i);
      let length = 1;
      while (i + length < value.length && oldIndex(i + length) === (base < 0 ? -1 : base + length)) length++;
      if (base !== i) sameOrder = false;
      this.uint(base + 1);
      this.uint(length);
      runs++;
      i += length;
    }
    this.finishCount(runsAt, runs);
    const changesAt = this.reserveCount();
    let count = 0;
    for (let i = 0; i < value.length; i++) {
      const entryStart = this.offset;
      this.uint(i);
      if (this.patch(value[i], baseline[oldIndex(i)], '')) count++;
      else this.offset = entryStart;
    }
    if (sameOrder && count === 0) { this.offset = start; this.byte(Tag.Same); return false; }
    this.finishCount(changesAt, count);
    return true;
  }

  private value(value: Value, key: string): void {
    if (value === undefined) { this.byte(Tag.Undefined); return; }
    if (value === null) { this.byte(Tag.Null); return; }
    if (typeof value === 'boolean') { this.byte(value ? Tag.True : Tag.False); return; }
    if (typeof value === 'number') {
      if (key === 'x' || key === 'y' || key === 'anchorX' || key === 'anchorY') {
        this.byte(Tag.U16); this.byte(value & 255); this.byte(value >>> 8);
      } else if (Number.isSafeInteger(value) && Math.abs(value) < 0x40000000) {
        this.byte(Tag.Int); this.uint(value >= 0 ? value * 2 : -value * 2 - 1);
      } else {
        this.byte(Tag.Float);
        this.ensure(8);
        this.data.setFloat64(this.offset, value, true);
        this.offset += 8;
      }
      return;
    }
    if (typeof value === 'string') { this.byte(Tag.String); this.string(value); return; }
    if (Array.isArray(value)) {
      this.byte(Tag.Array); this.uint(value.length);
      for (const entry of value) this.value(entry, '');
      return;
    }
    this.byte(Tag.Object);
    const at = this.reserveCount();
    let count = 0;
    for (const field in value) {
      if (!Object.hasOwn(value, field) || value[field] === undefined) continue;
      this.key(field); this.value(value[field], field); count++;
    }
    this.finishCount(at, count);
  }
}

class Reader {
  offset = 0;
  private budget = 100_000;
  private readonly data: DataView;
  constructor(private readonly bytes: Uint8Array, private readonly version: number) { this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
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
    if (id > LEGACY_KEYS.length && this.version < 2) throw new Error('Invalid snapshot field');
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
        const value = this.data.getFloat64(this.offset, true);
        this.offset += 8;
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
        if ((this.budget -= length) < 0) throw new Error('Snapshot decode budget exceeded');
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
      case Tag.KeyedArrayDelta: {
        if (this.version < 2 || !Array.isArray(baseline)) throw new Error('Invalid keyed array baseline');
        const length = this.count(), runs = this.count();
        if ((this.budget -= length) < 0) throw new Error('Snapshot decode budget exceeded');
        const result: Value[] = [];
        const used = new Uint8Array(baseline.length);
        for (let i = 0; i < runs; i++) {
          const base = this.uint() - 1, count = this.count();
          if (count < 1 || result.length + count > length || (base >= 0 && base + count > baseline.length)) throw new Error('Invalid snapshot entity run');
          for (let j = 0; j < count; j++) {
            if (base >= 0 && used[base + j]++) throw new Error('Duplicate snapshot entity reference');
            result.push(base < 0 ? undefined : baseline[base + j]);
          }
        }
        if (result.length !== length) throw new Error('Incomplete snapshot entity order');
        const changes = this.count();
        let previous = -1;
        for (let i = 0; i < changes; i++) {
          const index = this.uint();
          if (index >= length || index <= previous) throw new Error('Invalid snapshot entity index');
          previous = index;
          result[index] = this.value(result[index], depth + 1);
        }
        if (result.some((entry) => entry === undefined)) throw new Error('Missing new snapshot entity');
        return result;
      }
      default: throw new Error('Unknown snapshot tag');
    }
  }
}
