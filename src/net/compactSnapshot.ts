import type { EngineSnapshot } from '../engine/protocol';

export type NetworkSnapshot = Omit<EngineSnapshot, 'mechanicTraces' | 'aiTraces'>;

export function toNetworkSnapshot(snapshot: EngineSnapshot): NetworkSnapshot {
  const networkSnapshot: Partial<EngineSnapshot> = { ...snapshot };
  delete networkSnapshot.mechanicTraces;
  delete networkSnapshot.aiTraces;
  return networkSnapshot as NetworkSnapshot;
}

export function fromNetworkSnapshot(snapshot: NetworkSnapshot): EngineSnapshot {
  return {
    ...snapshot,
    mechanicTraces: [],
    aiTraces: [],
  };
}

export function estimateSnapshotBytes(snapshot: NetworkSnapshot | EngineSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}

type Shape = Record<string, 'string' | 'number' | 'boolean' | Shape[] | { optional: Shape | 'string' | 'number' | 'boolean' }>;
const status: Shape = { id: 'string', name: 'string', color: 'string', tags: [{ $: 'string' }], stacks: 'number', remainingTicks: 'number', durationTicks: 'number',
  movementMultiplier: { optional: 'number' }, damageDealtMultiplier: { optional: 'number' }, damageTakenMultiplier: { optional: 'number' } };
const resource: Shape = { id: 'string', name: 'string', color: 'string', value: 'number', max: 'number' };
const player: Shape = {
  playerId: 'string', displayName: 'string', x: 'number', y: 'number', vx: 'number', vy: 'number', hue: 'number', hp: 'number', maxHp: 'number',
  alive: 'boolean', respawnTick: 'number', slotCooldownTicks: [{ $: 'number' }], lastUsedSlot: 'number', aimDx: 'number', aimDy: 'number',
  facingDx: 'number', facingDy: 'number', role: 'string', team: 'string', lastInputSequence: 'number', statuses: [status], resources: [resource],
  jumpHeld: { optional: 'boolean' },
  status: { optional: { slowMultiplier: 'number', slowTicks: 'number', slowColor: 'string' } },
  charging: { optional: { slot: 'number', abilityId: 'string', chargeTicks: 'number', maxTicks: 'number', ratio: 'number', aimDx: 'number', aimDy: 'number' } },
};
const snapshotShape: Shape = {
  tick: 'number', nowMs: 'number', rulesetId: 'string',
  match: { optional: { elapsedTicks: 'number', remainingTicks: 'number', durationTicks: 'number', scoreLimit: 'number', finished: 'boolean',
    winnerTeamId: { optional: 'string' }, teams: [{ id: 'string', name: 'string', color: 'string', score: 'number' }] } },
  players: [player],
  objectives: [{ objectiveId: 'string', name: 'string', kind: 'string', bodyId: { optional: 'string' }, x: 'number', y: 'number', vx: 'number', vy: 'number',
    radius: 'number', color: 'string', activeZoneId: { optional: 'string' }, lastScoredTeamId: { optional: 'string' }, scoreCooldownTicks: 'number',
    controllingTeamId: { optional: 'string' }, contestProgress: { optional: 'number' },
    zones: [{ zoneId: 'string', team: 'string', x: 'number', y: 'number', radius: 'number', points: 'number', color: 'string' }] }],
  projectiles: [{ projectileId: 'string', ownerId: 'string', abilityId: 'string', x: 'number', y: 'number', radius: 'number', color: 'string' }],
  physicsBodies: [{ bodyId: 'string', ownerId: { optional: 'string' }, sourceAbilityId: { optional: 'string' }, x: 'number', y: 'number', vx: 'number', vy: 'number', radius: 'number', color: 'string', remainingTicks: 'number' }],
  constraints: [{ constraintId: 'string', kind: 'string', targetId: 'string', ownerId: { optional: 'string' }, sourceAbilityId: { optional: 'string' }, anchorBodyId: { optional: 'string' }, anchorX: 'number', anchorY: 'number', length: 'number', color: 'string', remainingTicks: 'number' }],
  effects: [{ effectId: 'string', kind: 'string', x: 'number', y: 'number', radius: 'number', color: 'string', ageTicks: 'number', lifetimeTicks: 'number' }],
  combatTexts: [{ textId: 'string', kind: 'string', x: 'number', y: 'number', amount: 'number', color: 'string', ageTicks: 'number', lifetimeTicks: 'number' }],
};

/** Validate reconstructed wire state before it reaches rendering or the baseline cache. */
export function isNetworkSnapshot(value: unknown): value is NetworkSnapshot {
  if (!matchesShape(value, snapshotShape) || !isRecord(value) || !isRecord(value.match)) return false;
  return Number.isSafeInteger(value.tick) && (value.tick as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesShape(value: unknown, shape: Shape): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(shape).every(([key, rule]) => {
    const field = value[key];
    if (Array.isArray(rule)) {
      if (!Array.isArray(field) || field.length > 16_384) return false;
      return Array.from(field).every((entry) => rule[0].$ ? primitive(entry, rule[0].$) : matchesShape(entry, rule[0]));
    }
    if (typeof rule === 'string') return primitive(field, rule);
    return field === undefined || (typeof rule.optional === 'string' ? primitive(field, rule.optional) : matchesShape(field, rule.optional));
  });
}

function primitive(value: unknown, kind: unknown): boolean {
  return typeof value === kind && (kind !== 'number' || Number.isFinite(value)) && (kind !== 'string' || (value as string).length <= 16_384);
}
