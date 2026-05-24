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
  charge?: AbilityCharge;
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
  };
  obstacles: RectObstacle[];
  abilities: Ability[];
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
  charging?: ChargingSnapshot;
  lastInputSequence: number;
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
  kind: 'impact' | 'melee' | 'spawn' | 'death';
  x: number;
  y: number;
  radius: number;
  color: string;
  ageTicks: number;
  lifetimeTicks: number;
};

export type CombatTextSnapshot = {
  textId: string;
  kind: 'damage' | 'heal';
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
