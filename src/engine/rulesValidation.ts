import type {
  Ability,
  AbilityCharge,
  AbilityEffect,
  MechanicAction,
  MechanicCondition,
  MechanicDirectionRef,
  MechanicEventKind,
  MechanicPlayerRef,
  MechanicTrigger,
  MechanicsConfig,
  MeleeAbility,
  ProjectileAbility,
  ResourceDefinition,
  Ruleset,
  StatusDefinition,
} from './protocol';

export function parseRulesetJson(json: string): Ruleset {
  const parsed = JSON.parse(json) as unknown;
  return validateRuleset(parsed);
}

export function validateRuleset(value: unknown): Ruleset {
  const ruleset = assertRecord(value, 'ruleset');
  const abilities = readArray(ruleset.abilities, 'abilities').map(validateAbility);
  const mechanics = validateMechanics(ruleset.mechanics);
  const loadout = assertRecord(ruleset.loadout, 'loadout');
  const abilityIds = validateLoadoutAbilityIds(loadout.abilityIds, abilities);
  validateMechanicReferences(abilities, mechanics);

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
    mechanics,
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
    movement: validatePlayerMovement(player.movement),
    aim: validatePlayerAim(player.aim),
  };
}

function validatePlayerMovement(value: unknown): Ruleset['player']['movement'] {
  const movement = assertRecord(value, 'player.movement');
  const mode = readString(movement.mode, 'player.movement.mode');
  if (mode !== 'twinStick' && mode !== 'tank') {
    throw new Error('player.movement.mode must be twinStick or tank');
  }
  return {
    mode,
    turnSpeedDegrees: readNumber(movement.turnSpeedDegrees, 'player.movement.turnSpeedDegrees', 30, 1_440),
    reverseMultiplier: readNumber(movement.reverseMultiplier, 'player.movement.reverseMultiplier', 0, 1),
  };
}

function validatePlayerAim(value: unknown): Ruleset['player']['aim'] {
  const aim = assertRecord(value, 'player.aim');
  const mode = readString(aim.mode, 'player.aim.mode');
  if (mode === 'free' || mode === 'facing') {
    return { mode };
  }
  throw new Error('player.aim.mode must be free or facing');
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

function validateMechanics(value: unknown): MechanicsConfig {
  if (value === undefined) {
    return { statuses: [], resources: [], triggers: [] };
  }
  const mechanics = assertRecord(value, 'mechanics');
  const statuses = readArray(mechanics.statuses, 'mechanics.statuses').map(validateStatusDefinition);
  const resources = readArray(mechanics.resources, 'mechanics.resources').map(validateResourceDefinition);
  const triggers = readArray(mechanics.triggers, 'mechanics.triggers').map(validateMechanicTrigger);
  assertUniqueIds(statuses, 'mechanics.statuses');
  assertUniqueIds(resources, 'mechanics.resources');
  assertUniqueIds(triggers, 'mechanics.triggers');
  return { statuses, resources, triggers };
}

function validateStatusDefinition(value: unknown): StatusDefinition {
  const status = assertRecord(value, 'mechanics.status');
  const stacking = status.stacking === undefined ? undefined : validateStatusStacking(status.stacking);
  const maxStacks = status.maxStacks === undefined ? undefined : readInt(status.maxStacks, 'mechanics.status.maxStacks', 1, 50);
  const movementMultiplier = readOptionalNumber(status.movementMultiplier, 'mechanics.status.movementMultiplier', 0.05, 5);
  const damageDealtMultiplier = readOptionalNumber(status.damageDealtMultiplier, 'mechanics.status.damageDealtMultiplier', 0, 10);
  const damageTakenMultiplier = readOptionalNumber(status.damageTakenMultiplier, 'mechanics.status.damageTakenMultiplier', 0, 10);
  return {
    id: readId(status.id, 'mechanics.status.id'),
    name: clampString(readString(status.name, 'mechanics.status.name'), 1, 36, 'mechanics.status.name'),
    color: readColor(status.color, 'mechanics.status.color'),
    durationTicks: readInt(status.durationTicks, 'mechanics.status.durationTicks', 1, 3_600),
    tags: validateTags(status.tags, 'mechanics.status.tags'),
    ...(stacking === undefined ? {} : { stacking }),
    ...(maxStacks === undefined ? {} : { maxStacks }),
    ...(movementMultiplier === undefined ? {} : { movementMultiplier }),
    ...(damageDealtMultiplier === undefined ? {} : { damageDealtMultiplier }),
    ...(damageTakenMultiplier === undefined ? {} : { damageTakenMultiplier }),
    periodic: validateStatusPeriodic(status.periodic),
  };
}

function validateStatusStacking(value: unknown): StatusDefinition['stacking'] {
  const stacking = readString(value, 'mechanics.status.stacking');
  if (stacking === 'refresh' || stacking === 'stack') {
    return stacking;
  }
  throw new Error('mechanics.status.stacking must be refresh or stack');
}

function validateStatusPeriodic(value: unknown): StatusDefinition['periodic'] {
  if (value === undefined) {
    return undefined;
  }
  const periodic = assertRecord(value, 'mechanics.status.periodic');
  const actions = readArray(periodic.actions, 'mechanics.status.periodic.actions').map((action) =>
    validateMechanicAction(action, 'mechanics.status.periodic.action'),
  );
  if (actions.length === 0) {
    throw new Error('mechanics.status.periodic.actions must contain at least one action');
  }
  return {
    everyTicks: readInt(periodic.everyTicks, 'mechanics.status.periodic.everyTicks', 1, 1_200),
    actions,
  };
}

function validateResourceDefinition(value: unknown): ResourceDefinition {
  const resource = assertRecord(value, 'mechanics.resource');
  const max = readNumber(resource.max, 'mechanics.resource.max', 1, 100_000);
  const start = readNumber(resource.start, 'mechanics.resource.start', 0, max);
  return {
    id: readId(resource.id, 'mechanics.resource.id'),
    name: clampString(readString(resource.name, 'mechanics.resource.name'), 1, 36, 'mechanics.resource.name'),
    color: readColor(resource.color, 'mechanics.resource.color'),
    max,
    start,
    regenPerTick: readNumber(resource.regenPerTick, 'mechanics.resource.regenPerTick', -100, 100),
  };
}

function validateMechanicTrigger(value: unknown): MechanicTrigger {
  const trigger = assertRecord(value, 'mechanics.trigger');
  const conditions =
    trigger.conditions === undefined
      ? undefined
      : readArray(trigger.conditions, 'mechanics.trigger.conditions').map(validateMechanicCondition);
  const actions = readArray(trigger.actions, 'mechanics.trigger.actions').map((action) => validateMechanicAction(action, 'mechanics.trigger.action'));
  if (actions.length === 0) {
    throw new Error('mechanics.trigger.actions must contain at least one action');
  }
  return {
    id: readId(trigger.id, 'mechanics.trigger.id'),
    name: trigger.name === undefined ? undefined : clampString(readString(trigger.name, 'mechanics.trigger.name'), 1, 48, 'mechanics.trigger.name'),
    event: validateMechanicEvent(trigger.event),
    ...(conditions === undefined || conditions.length === 0 ? {} : { conditions }),
    actions,
  };
}

function validateMechanicEvent(value: unknown): MechanicEventKind {
  const event = readString(value, 'mechanics.trigger.event');
  if (
    event === 'onCast' ||
    event === 'onHit' ||
    event === 'onDamageTaken' ||
    event === 'onStatusApplied' ||
    event === 'onStatusExpired' ||
    event === 'onKill' ||
    event === 'onLowHp'
  ) {
    return event;
  }
  throw new Error('mechanics.trigger.event must be a supported event hook');
}

function validateMechanicCondition(value: unknown): MechanicCondition {
  const condition = assertRecord(value, 'mechanics.trigger.condition');
  const kind = readString(condition.kind, 'mechanics.trigger.condition.kind');
  if (kind === 'hasStatus' || kind === 'missingStatus') {
    return {
      kind,
      target: validatePlayerRef(condition.target, 'mechanics.trigger.condition.target'),
      statusId: readId(condition.statusId, 'mechanics.trigger.condition.statusId'),
    };
  }
  if (kind === 'hpBelow') {
    return {
      kind,
      target: validatePlayerRef(condition.target, 'mechanics.trigger.condition.target'),
      ratio: readNumber(condition.ratio, 'mechanics.trigger.condition.ratio', 0, 1),
    };
  }
  if (kind === 'resourceAtLeast') {
    return {
      kind,
      target: validatePlayerRef(condition.target, 'mechanics.trigger.condition.target'),
      resourceId: readId(condition.resourceId, 'mechanics.trigger.condition.resourceId'),
      amount: readNumber(condition.amount, 'mechanics.trigger.condition.amount', 0, 100_000),
    };
  }
  if (kind === 'slotUsed') {
    return {
      kind,
      slot: readInt(condition.slot, 'mechanics.trigger.condition.slot', 0, 3),
    };
  }
  if (kind === 'abilityTag') {
    return {
      kind,
      tag: readTag(condition.tag, 'mechanics.trigger.condition.tag'),
    };
  }
  throw new Error('mechanics.trigger.condition.kind must be supported');
}

function validateMechanicAction(value: unknown, label: string): MechanicAction {
  const action = assertRecord(value, label);
  const kind = readString(action.kind, `${label}.kind`);
  if (kind === 'applyStatus') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      statusId: readId(action.statusId, `${label}.statusId`),
      ...(action.durationTicks === undefined ? {} : { durationTicks: readInt(action.durationTicks, `${label}.durationTicks`, 1, 3_600) }),
      ...(action.stacks === undefined ? {} : { stacks: readInt(action.stacks, `${label}.stacks`, 1, 50) }),
    };
  }
  if (kind === 'removeStatus') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      statusId: readId(action.statusId, `${label}.statusId`),
    };
  }
  if (kind === 'dealDamage') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      amount: readNumber(action.amount, `${label}.amount`, 0, 10_000),
      ...(action.color === undefined ? {} : { color: readColor(action.color, `${label}.color`) }),
    };
  }
  if (kind === 'heal') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      amount: readNumber(action.amount, `${label}.amount`, 0, 10_000),
    };
  }
  if (kind === 'knockback') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      force: readNumber(action.force, `${label}.force`, 0.05, 12),
      direction: validateDirectionRef(action.direction),
      ...(action.color === undefined ? {} : { color: readColor(action.color, `${label}.color`) }),
    };
  }
  if (kind === 'slow') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      multiplier: readNumber(action.multiplier, `${label}.multiplier`, 0.05, 1),
      durationTicks: readInt(action.durationTicks, `${label}.durationTicks`, 1, 1_200),
      ...(action.color === undefined ? {} : { color: readColor(action.color, `${label}.color`) }),
    };
  }
  if (kind === 'modifyResource') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      resourceId: readId(action.resourceId, `${label}.resourceId`),
      amount: readNumber(action.amount, `${label}.amount`, -100_000, 100_000),
    };
  }
  if (kind === 'flashEffect') {
    return {
      kind,
      target: validatePlayerRef(action.target, `${label}.target`),
      radius: readNumber(action.radius, `${label}.radius`, 0.05, 30),
      ...(action.color === undefined ? {} : { color: readColor(action.color, `${label}.color`) }),
    };
  }
  throw new Error(`${label}.kind must be supported`);
}

function validatePlayerRef(value: unknown, label: string): MechanicPlayerRef {
  const target = readString(value, label);
  if (target === 'source' || target === 'target') {
    return target;
  }
  throw new Error(`${label} must be source or target`);
}

function validateDirectionRef(value: unknown): MechanicDirectionRef | undefined {
  if (value === undefined) {
    return undefined;
  }
  const direction = readString(value, 'mechanics.action.direction');
  if (direction === 'sourceToTarget' || direction === 'targetToSource' || direction === 'aim') {
    return direction;
  }
  throw new Error('mechanics.action.direction must be sourceToTarget, targetToSource, or aim');
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
    tags: validateTags(ability.tags, 'ability.tags'),
    charge: validateCharge(ability.charge),
    effects: validateEffects(ability.effects),
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

function validateCharge(value: unknown): AbilityCharge | undefined {
  if (value === undefined) {
    return undefined;
  }
  const charge = assertRecord(value, 'ability.charge');
  const damageMultiplierMin = readNumber(charge.damageMultiplierMin, 'ability.charge.damageMultiplierMin', 0, 20);
  const damageMultiplierMax = readNumber(charge.damageMultiplierMax, 'ability.charge.damageMultiplierMax', 0, 20);
  if (damageMultiplierMax < damageMultiplierMin) {
    throw new Error('ability.charge.damageMultiplierMax must be greater than or equal to damageMultiplierMin');
  }
  const rangeMultiplierMin = readOptionalNumber(charge.rangeMultiplierMin, 'ability.charge.rangeMultiplierMin', 0, 20);
  const rangeMultiplierMax = readOptionalNumber(charge.rangeMultiplierMax, 'ability.charge.rangeMultiplierMax', 0, 20);
  validateOptionalMultiplierPair(rangeMultiplierMin, rangeMultiplierMax, 'ability.charge.rangeMultiplier');
  const radiusMultiplierMin = readOptionalNumber(charge.radiusMultiplierMin, 'ability.charge.radiusMultiplierMin', 0, 20);
  const radiusMultiplierMax = readOptionalNumber(charge.radiusMultiplierMax, 'ability.charge.radiusMultiplierMax', 0, 20);
  validateOptionalMultiplierPair(radiusMultiplierMin, radiusMultiplierMax, 'ability.charge.radiusMultiplier');
  const autoRelease = charge.autoRelease === undefined ? true : readBoolean(charge.autoRelease, 'ability.charge.autoRelease');
  if (autoRelease !== true) {
    throw new Error('ability.charge.autoRelease must be true');
  }
  return {
    maxTicks: readInt(charge.maxTicks, 'ability.charge.maxTicks', 1, 600),
    moveSpeedMultiplier: readOptionalNumber(charge.moveSpeedMultiplier, 'ability.charge.moveSpeedMultiplier', 0, 1) ?? 0.55,
    damageMultiplierMin,
    damageMultiplierMax,
    ...(rangeMultiplierMin === undefined ? {} : { rangeMultiplierMin }),
    ...(rangeMultiplierMax === undefined ? {} : { rangeMultiplierMax }),
    ...(radiusMultiplierMin === undefined ? {} : { radiusMultiplierMin }),
    ...(radiusMultiplierMax === undefined ? {} : { radiusMultiplierMax }),
    autoRelease,
  };
}

function validateEffects(value: unknown): AbilityEffect[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const effects = readArray(value, 'ability.effects').map(validateEffect);
  return effects.length > 0 ? effects : undefined;
}

function validateEffect(value: unknown): AbilityEffect {
  const effect = assertRecord(value, 'ability.effect');
  const kind = readString(effect.kind, 'ability.effect.kind');
  if (kind === 'knockback') {
    return {
      kind,
      force: readNumber(effect.force, 'ability.effect.force', 0.05, 12),
    };
  }
  if (kind === 'slow') {
    return {
      kind,
      multiplier: readNumber(effect.multiplier, 'ability.effect.multiplier', 0.05, 1),
      durationTicks: readInt(effect.durationTicks, 'ability.effect.durationTicks', 1, 1_200),
    };
  }
  if (kind === 'heal') {
    return {
      kind,
      target: validateHealTarget(effect.target),
      amount: readNumber(effect.amount, 'ability.effect.amount', 0, 10_000),
    };
  }
  if (kind === 'selfDash') {
    return {
      kind,
      distance: readNumber(effect.distance, 'ability.effect.distance', 0.05, 12),
    };
  }
  if (kind === 'applyStatus') {
    return {
      kind,
      target: validateApplyStatusTarget(effect.target),
      statusId: readId(effect.statusId, 'ability.effect.statusId'),
      ...(effect.durationTicks === undefined ? {} : { durationTicks: readInt(effect.durationTicks, 'ability.effect.durationTicks', 1, 3_600) }),
      ...(effect.stacks === undefined ? {} : { stacks: readInt(effect.stacks, 'ability.effect.stacks', 1, 50) }),
    };
  }
  throw new Error('ability.effect.kind must be knockback, slow, heal, selfDash, or applyStatus');
}

function validateHealTarget(value: unknown): 'self' | 'hit' {
  const target = readString(value, 'ability.effect.target');
  if (target === 'self' || target === 'hit') {
    return target;
  }
  throw new Error('ability.effect.target must be self or hit');
}

function validateApplyStatusTarget(value: unknown): 'self' | 'hit' {
  const target = readString(value, 'ability.effect.target');
  if (target === 'self' || target === 'hit') {
    return target;
  }
  throw new Error('ability.effect.target must be self or hit');
}

function validateTargeting(value: unknown): Ability['targeting'] {
  const targeting = readString(value, 'ability.targeting');
  if (targeting === 'free-aim' || targeting === 'aim-assist') {
    return targeting;
  }
  throw new Error('ability.targeting must be free-aim or aim-assist');
}

function validateTags(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const tags = readArray(value, label).map((tag, index) => readTag(tag, `${label}[${index}]`));
  return tags.length > 0 ? Array.from(new Set(tags)) : undefined;
}

function validateMechanicReferences(abilities: Ability[], mechanics: MechanicsConfig): void {
  const statusIds = new Set(mechanics.statuses.map((status) => status.id));
  const resourceIds = new Set(mechanics.resources.map((resource) => resource.id));
  for (const ability of abilities) {
    for (const effect of ability.effects ?? []) {
      if (effect.kind === 'applyStatus' && !statusIds.has(effect.statusId)) {
        throw new Error(`ability.effects for ${ability.id} references unknown status ${effect.statusId}`);
      }
    }
  }
  for (const status of mechanics.statuses) {
    for (const action of status.periodic?.actions ?? []) {
      validateActionReferences(action, statusIds, resourceIds, `mechanics.status ${status.id}`);
    }
  }
  for (const trigger of mechanics.triggers) {
    for (const condition of trigger.conditions ?? []) {
      validateConditionReferences(condition, statusIds, resourceIds, trigger.id);
    }
    for (const action of trigger.actions) {
      validateActionReferences(action, statusIds, resourceIds, `mechanics.trigger ${trigger.id}`);
    }
  }
}

function validateConditionReferences(condition: MechanicCondition, statusIds: Set<string>, resourceIds: Set<string>, triggerId: string): void {
  if ((condition.kind === 'hasStatus' || condition.kind === 'missingStatus') && !statusIds.has(condition.statusId)) {
    throw new Error(`mechanics.trigger ${triggerId} references unknown status ${condition.statusId}`);
  }
  if (condition.kind === 'resourceAtLeast' && !resourceIds.has(condition.resourceId)) {
    throw new Error(`mechanics.trigger ${triggerId} references unknown resource ${condition.resourceId}`);
  }
}

function validateActionReferences(action: MechanicAction, statusIds: Set<string>, resourceIds: Set<string>, label: string): void {
  if ((action.kind === 'applyStatus' || action.kind === 'removeStatus') && !statusIds.has(action.statusId)) {
    throw new Error(`${label} references unknown status ${action.statusId}`);
  }
  if (action.kind === 'modifyResource' && !resourceIds.has(action.resourceId)) {
    throw new Error(`${label} references unknown resource ${action.resourceId}`);
  }
}

function assertUniqueIds(values: Array<{ id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      throw new Error(`${label} contains duplicate id ${value.id}`);
    }
    seen.add(value.id);
  }
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

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
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

function readTag(value: unknown, label: string): string {
  const tag = clampString(readString(value, label), 1, 32, label);
  if (!/^[a-zA-Z0-9:_-]+$/.test(tag)) {
    throw new Error(`${label} may only contain letters, numbers, colon, dash, and underscore`);
  }
  return tag;
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

function readOptionalNumber(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readNumber(value, label, min, max);
}

function readInt(value: unknown, label: string, min: number, max: number): number {
  const number = readNumber(value, label, min, max);
  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be an integer`);
  }
  return number;
}

function validateOptionalMultiplierPair(min: number | undefined, max: number | undefined, label: string): void {
  if ((min === undefined) !== (max === undefined)) {
    throw new Error(`${label}Min and ${label}Max must be provided together`);
  }
  if (min !== undefined && max !== undefined && max < min) {
    throw new Error(`${label}Max must be greater than or equal to ${label}Min`);
  }
}

function clampString(value: string, minLength: number, maxLength: number, label: string): string {
  const text = value.trim();
  if (text.length < minLength || text.length > maxLength) {
    throw new Error(`${label} must be ${minLength}-${maxLength} characters`);
  }
  return text;
}
