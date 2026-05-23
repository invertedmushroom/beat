import type { Ability, MeleeAbility, ProjectileAbility, Ruleset } from './protocol';

export function parseRulesetJson(json: string): Ruleset {
  const parsed = JSON.parse(json) as unknown;
  return validateRuleset(parsed);
}

export function validateRuleset(value: unknown): Ruleset {
  const ruleset = assertRecord(value, 'ruleset');
  const abilities = readArray(ruleset.abilities, 'abilities').map(validateAbility);
  const loadout = assertRecord(ruleset.loadout, 'loadout');
  const abilityIds = validateLoadoutAbilityIds(loadout.abilityIds, abilities);

  return {
    id: readId(ruleset.id, 'id'),
    name: clampString(readString(ruleset.name, 'name'), 1, 48, 'name'),
    version: readInt(ruleset.version, 'version', 1, 999),
    tickRate: readInt(ruleset.tickRate, 'tickRate', 10, 120),
    maxPlayers: readInt(ruleset.maxPlayers, 'maxPlayers', 1, 16),
    mapBundleId: readId(ruleset.mapBundleId, 'mapBundleId'),
    contentHash: clampString(readString(ruleset.contentHash, 'contentHash'), 1, 128, 'contentHash'),
    arena: validateArena(ruleset.arena),
    player: validatePlayer(ruleset.player),
    obstacles: readArray(ruleset.obstacles, 'obstacles').map(validateObstacle),
    abilities,
    loadout: { abilityIds },
  };
}

export function stringifyRuleset(ruleset: Ruleset): string {
  return `${JSON.stringify(ruleset, null, 2)}\n`;
}

function validateArena(value: unknown): Ruleset['arena'] {
  const arena = assertRecord(value, 'arena');
  return {
    width: readNumber(arena.width, 'arena.width', 12, 120),
    height: readNumber(arena.height, 'arena.height', 8, 80),
  };
}

function validatePlayer(value: unknown): Ruleset['player'] {
  const player = assertRecord(value, 'player');
  return {
    radius: readNumber(player.radius, 'player.radius', 0.2, 2),
    speed: readNumber(player.speed, 'player.speed', 1, 30),
    damping: readNumber(player.damping, 'player.damping', 0, 30),
    maxHp: readInt(player.maxHp, 'player.maxHp', 1, 10_000),
    respawnTicks: readInt(player.respawnTicks, 'player.respawnTicks', 0, 600),
  };
}

function validateObstacle(value: unknown): Ruleset['obstacles'][number] {
  const obstacle = assertRecord(value, 'obstacle');
  return {
    id: readId(obstacle.id, 'obstacle.id'),
    x: readNumber(obstacle.x, 'obstacle.x', -200, 200),
    y: readNumber(obstacle.y, 'obstacle.y', -200, 200),
    halfWidth: readNumber(obstacle.halfWidth, 'obstacle.halfWidth', 0.1, 20),
    halfHeight: readNumber(obstacle.halfHeight, 'obstacle.halfHeight', 0.1, 20),
  };
}

function validateLoadoutAbilityIds(value: unknown, abilities: Ability[]): string[] {
  const abilityIds = readArray(value, 'loadout.abilityIds');
  if (abilityIds.length !== 4) {
    throw new Error('loadout.abilityIds must contain exactly four ability ids');
  }
  return abilityIds.map((abilityId, index) => {
    const id = readId(abilityId, `loadout.abilityIds[${index}]`);
    if (!abilities.some((ability) => ability.id === id)) {
      throw new Error(`loadout.abilityIds[${index}] must reference an ability`);
    }
    return id;
  });
}

function validateAbility(value: unknown): Ability {
  const ability = assertRecord(value, 'ability');
  const base = {
    id: readId(ability.id, 'ability.id'),
    name: clampString(readString(ability.name, 'ability.name'), 1, 36, 'ability.name'),
    targeting: validateTargeting(ability.targeting),
    damage: readNumber(ability.damage, 'ability.damage', 0, 10_000),
    cooldownTicks: readInt(ability.cooldownTicks, 'ability.cooldownTicks', 1, 3_600),
    radius: readNumber(ability.radius, 'ability.radius', 0.05, 10),
    range: readNumber(ability.range, 'ability.range', 0.1, 100),
    color: readColor(ability.color, 'ability.color'),
  };
  const shape = readString(ability.shape, 'ability.shape');
  if (shape === 'projectile') {
    return {
      ...base,
      shape,
      speed: readNumber(ability.speed, 'ability.speed', 0.05, 10),
      lifetimeTicks: readInt(ability.lifetimeTicks, 'ability.lifetimeTicks', 1, 1_200),
    } satisfies ProjectileAbility;
  }
  if (shape === 'melee') {
    return {
      ...base,
      shape,
      arcDegrees: readNumber(ability.arcDegrees, 'ability.arcDegrees', 1, 360),
      windupTicks: readInt(ability.windupTicks, 'ability.windupTicks', 0, 120),
      activeTicks: readInt(ability.activeTicks, 'ability.activeTicks', 1, 120),
    } satisfies MeleeAbility;
  }
  throw new Error('ability.shape must be projectile or melee');
}

function validateTargeting(value: unknown): Ability['targeting'] {
  const targeting = readString(value, 'ability.targeting');
  if (targeting === 'free-aim' || targeting === 'aim-assist') {
    return targeting;
  }
  throw new Error('ability.targeting must be free-aim or aim-assist');
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function readId(value: unknown, label: string): string {
  const id = clampString(readString(value, label), 1, 96, label);
  if (!/^[a-zA-Z0-9:_-]+$/.test(id)) {
    throw new Error(`${label} may only contain letters, numbers, colon, dash, and underscore`);
  }
  return id;
}

function readColor(value: unknown, label: string): string {
  const color = readString(value, label);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`${label} must be a #rrggbb color`);
  }
  return color;
}

function readNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function readInt(value: unknown, label: string, min: number, max: number): number {
  const number = readNumber(value, label, min, max);
  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be an integer`);
  }
  return number;
}

function clampString(value: string, minLength: number, maxLength: number, label: string): string {
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new Error(`${label} must be ${minLength}-${maxLength} characters`);
  }
  return text;
}
