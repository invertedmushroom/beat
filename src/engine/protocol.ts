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
  damage: number;
  cooldownTicks: number;
  radius: number;
  range: number;
  color: string;
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
  lastInputSequence: number;
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
  kind: 'impact' | 'melee' | 'spawn';
  x: number;
  y: number;
  radius: number;
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
