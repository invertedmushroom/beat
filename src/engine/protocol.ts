export type RectObstacle = {
  id: string;
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
};

export type AbilityShape = 'projectile' | 'melee';
export type AbilityTargeting = 'free-aim' | 'aim-assist';

export type BaseAbility = {
  id: string;
  name: string;
  shape: AbilityShape;
  targeting: AbilityTargeting;
  tags?: string[];
  charge?: AbilityCharge;
  effects?: AbilityEffect[];
  damage: number;
  cooldownTicks: number;
  radius: number;
  range: number;
  color: string;
};

export type AbilityCharge = {
  maxTicks: number;
  moveSpeedMultiplier: number;
  damageMultiplierMin: number;
  damageMultiplierMax: number;
  rangeMultiplierMin?: number;
  rangeMultiplierMax?: number;
  radiusMultiplierMin?: number;
  radiusMultiplierMax?: number;
  autoRelease: true;
};

export type AbilityEffect = KnockbackEffect | SlowEffect | HealEffect | SelfDashEffect | ApplyStatusEffect;

export type KnockbackEffect = {
  kind: 'knockback';
  force: number;
};

export type SlowEffect = {
  kind: 'slow';
  multiplier: number;
  durationTicks: number;
};

export type HealEffect = {
  kind: 'heal';
  target: 'self' | 'hit';
  amount: number;
};

export type SelfDashEffect = {
  kind: 'selfDash';
  distance: number;
};

export type ApplyStatusEffect = {
  kind: 'applyStatus';
  target: 'self' | 'hit';
  statusId: string;
  durationTicks?: number;
  stacks?: number;
};

export type ProjectileAbility = BaseAbility & {
  shape: 'projectile';
  speed: number;
  lifetimeTicks: number;
};

export type MeleeAbility = BaseAbility & {
  shape: 'melee';
  arcDegrees: number;
  windupTicks: number;
  activeTicks: number;
};

export type Ability = ProjectileAbility | MeleeAbility;
export type PlayerMovementMode = 'twinStick' | 'tank';
export type PlayerAimMode = 'free' | 'facing';

export type PlayerMovementConfig = {
  mode: PlayerMovementMode;
  turnSpeedDegrees: number;
  reverseMultiplier: number;
};

export type PlayerAimConfig = {
  mode: PlayerAimMode;
};

export type MechanicsConfig = {
  statuses: StatusDefinition[];
  resources: ResourceDefinition[];
  triggers: MechanicTrigger[];
};

export type StatusDefinition = {
  id: string;
  name: string;
  color: string;
  durationTicks: number;
  tags?: string[];
  stacking?: 'refresh' | 'stack';
  maxStacks?: number;
  movementMultiplier?: number;
  damageDealtMultiplier?: number;
  damageTakenMultiplier?: number;
  periodic?: StatusPeriodic;
};

export type StatusPeriodic = {
  everyTicks: number;
  actions: MechanicAction[];
};

export type ResourceDefinition = {
  id: string;
  name: string;
  color: string;
  max: number;
  start: number;
  regenPerTick: number;
};

export type MechanicEventKind =
  | 'onCast'
  | 'onHit'
  | 'onDamageTaken'
  | 'onStatusApplied'
  | 'onStatusExpired'
  | 'onKill'
  | 'onLowHp';

export type MechanicPlayerRef = 'source' | 'target';

export type MechanicTrigger = {
  id: string;
  name?: string;
  event: MechanicEventKind;
  conditions?: MechanicCondition[];
  actions: MechanicAction[];
};

export type MechanicCondition =
  | { kind: 'hasStatus'; target: MechanicPlayerRef; statusId: string }
  | { kind: 'missingStatus'; target: MechanicPlayerRef; statusId: string }
  | { kind: 'hpBelow'; target: MechanicPlayerRef; ratio: number }
  | { kind: 'resourceAtLeast'; target: MechanicPlayerRef; resourceId: string; amount: number }
  | { kind: 'slotUsed'; slot: number }
  | { kind: 'abilityTag'; tag: string };

export type MechanicAction =
  | { kind: 'applyStatus'; target: MechanicPlayerRef; statusId: string; durationTicks?: number; stacks?: number }
  | { kind: 'removeStatus'; target: MechanicPlayerRef; statusId: string }
  | { kind: 'dealDamage'; target: MechanicPlayerRef; amount: number; color?: string }
  | { kind: 'heal'; target: MechanicPlayerRef; amount: number }
  | { kind: 'knockback'; target: MechanicPlayerRef; force: number; direction?: MechanicDirectionRef; color?: string }
  | { kind: 'slow'; target: MechanicPlayerRef; multiplier: number; durationTicks: number; color?: string }
  | { kind: 'modifyResource'; target: MechanicPlayerRef; resourceId: string; amount: number }
  | { kind: 'flashEffect'; target: MechanicPlayerRef; radius: number; color?: string };

export type MechanicDirectionRef = 'sourceToTarget' | 'targetToSource' | 'aim';

export type Ruleset = {
  id: string;
  name: string;
  version: number;
  tickRate: number;
  maxPlayers: number;
  mapBundleId: string;
  contentHash: string;
  arena: {
    width: number;
    height: number;
  };
  player: {
    radius: number;
    speed: number;
    damping: number;
    maxHp: number;
    respawnTicks: number;
    movement: PlayerMovementConfig;
    aim: PlayerAimConfig;
  };
  obstacles: RectObstacle[];
  abilities: Ability[];
  mechanics: MechanicsConfig;
  loadout: {
    abilityIds: string[];
  };
};

export type PlayerInput = {
  sequence: number;
  moveX: number;
  moveY: number;
  aimDx: number;
  aimDy: number;
  castSlots: number[];
  slotPresses: number[];
  slotReleases: number[];
  sampledAtMs: number;
};

export type PlayerSpawn = {
  playerId: string;
  displayName: string;
  hue: number;
  local: boolean;
};

export type PlayerSnapshot = {
  playerId: string;
  displayName: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTick: number;
  slotCooldownTicks: number[];
  lastUsedSlot: number;
  aimDx: number;
  aimDy: number;
  facingDx: number;
  facingDy: number;
  status?: PlayerStatusSnapshot;
  statuses: StatusSnapshot[];
  resources: ResourceSnapshot[];
  charging?: ChargingSnapshot;
  lastInputSequence: number;
};

export type PlayerStatusSnapshot = {
  slowMultiplier: number;
  slowTicks: number;
  slowColor: string;
};

export type StatusSnapshot = {
  id: string;
  name: string;
  color: string;
  tags: string[];
  stacks: number;
  remainingTicks: number;
  durationTicks: number;
  movementMultiplier?: number;
  damageDealtMultiplier?: number;
  damageTakenMultiplier?: number;
};

export type ResourceSnapshot = {
  id: string;
  name: string;
  color: string;
  value: number;
  max: number;
};

export type ChargingSnapshot = {
  slot: number;
  abilityId: string;
  chargeTicks: number;
  maxTicks: number;
  ratio: number;
  aimDx: number;
  aimDy: number;
};

export type ProjectileSnapshot = {
  projectileId: string;
  ownerId: string;
  abilityId: string;
  x: number;
  y: number;
  radius: number;
  color: string;
};

export type EffectSnapshot = {
  effectId: string;
  kind: 'impact' | 'melee' | 'spawn' | 'death' | 'knockback' | 'slow' | 'dash' | 'heal' | 'status' | 'trigger' | 'resource';
  x: number;
  y: number;
  radius: number;
  color: string;
  ageTicks: number;
  lifetimeTicks: number;
};

export type CombatTextSnapshot = {
  textId: string;
  kind: 'damage' | 'heal' | 'resource';
  x: number;
  y: number;
  amount: number;
  color: string;
  ageTicks: number;
  lifetimeTicks: number;
};

export type EngineSnapshot = {
  tick: number;
  nowMs: number;
  rulesetId: string;
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  effects: EffectSnapshot[];
  combatTexts: CombatTextSnapshot[];
};

export type EngineCommand =
  | { type: 'init'; ruleset: Ruleset; seed: number }
  | { type: 'add-player'; player: PlayerSpawn }
  | { type: 'remove-player'; playerId: string }
  | { type: 'input'; playerId: string; input: PlayerInput }
  | { type: 'stop' };

export type EngineEvent =
  | { type: 'ready'; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: EngineSnapshot }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };
