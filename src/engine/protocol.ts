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

export type AbilityEffect =
  | KnockbackEffect
  | SlowEffect
  | HealEffect
  | SelfDashEffect
  | ApplyStatusEffect
  | SpawnBodyEffect
  | SnareEffect
  | DragBodyEffect;

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

export type PhysicsBodySpec = {
  shape: 'ball';
  radius: number;
  mass: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  lifetimeTicks: number;
  color: string;
};

export type SpawnBodyEffect = {
  kind: 'spawnBody';
  target: 'self' | 'hit' | 'impact';
  body: PhysicsBodySpec;
  inheritVelocity?: number;
};

export type SnareEffect = {
  kind: 'snare';
  target: 'hit';
  anchor: 'impact' | 'body';
  durationTicks: number;
  radius: number;
  stiffness: number;
  damping: number;
  color?: string;
  body?: PhysicsBodySpec;
};

export type DragBodyEffect = {
  kind: 'dragBody';
  target: 'self' | 'hit';
  durationTicks: number;
  leashLength: number;
  stiffness: number;
  damping: number;
  color?: string;
  body: PhysicsBodySpec;
};

export type ProjectileWorldCollision = 'despawn' | 'phase';

export type ProjectileAbility = BaseAbility & {
  shape: 'projectile';
  worldCollision?: ProjectileWorldCollision;
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
export type PlayerMovementMode = 'twinStick' | 'tank' | 'platform';
export type PlayerAimMode = 'free' | 'facing';

export type PlatformMovementConfig = {
  gravity: number;
  jumpVelocity: number;
  airControl: number;
  maxFallSpeed: number;
  groundProbeDistance: number;
};

export type PlayerMovementConfig = {
  mode: PlayerMovementMode;
  turnSpeedDegrees: number;
  reverseMultiplier: number;
  platform: PlatformMovementConfig;
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
  | 'onLowHp'
  | 'onObjectiveEnter'
  | 'onObjectiveTick'
  | 'onScore';

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
  | { kind: 'abilityTag'; tag: string }
  | { kind: 'objectiveId'; objectiveId: string }
  | { kind: 'scoringTeam'; teamId: string };

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

export type MatchConfig = {
  teams: MatchTeam[];
  durationTicks: number;
  scoreLimit: number;
  friendlyFire: boolean;
  respawnMode: 'timed';
};

export type MatchTeam = {
  id: string;
  name: string;
  color: string;
};

export type ObjectiveDefinition = RelicPushObjective;

export type RelicPushObjective = {
  id: string;
  name: string;
  kind: 'relicPush';
  spawn: {
    x: number;
    y: number;
  };
  body: PhysicsBodySpec;
  scoreZones: ObjectiveScoreZone[];
  scoreCooldownTicks: number;
  resetOnScore: boolean;
};

export type ObjectiveScoreZone = {
  id: string;
  team: string;
  x: number;
  y: number;
  radius: number;
  points: number;
  color?: string;
};

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
  match: MatchConfig;
  objectives: ObjectiveDefinition[];
  npcs: NpcConfig;
  loadout: {
    abilityIds: string[];
  };
};

export type NpcConfig = {
  archetypes: NpcArchetype[];
  labSpawns: NpcSpawn[];
  sessionSpawns: NpcSpawn[];
};

export type NpcBehaviorMode = 'idle' | 'wander' | 'seek' | 'kite';

export type NpcArchetype = {
  id: string;
  name: string;
  hue: number;
  team: string;
  hpMultiplier: number;
  speedMultiplier: number;
  loadout: {
    abilityIds: string[];
  };
  behavior: {
    mode: NpcBehaviorMode;
    aggroRange: number;
    preferredRange: number;
    wanderRadius: number;
  };
  casting: {
    slots: number[];
    minRange: number;
    maxRange: number;
  };
};

export type NpcSpawn = {
  id: string;
  archetypeId: string;
  x: number;
  y: number;
  team?: string;
};

export type RuntimeNpcConfig = {
  archetypeId: string;
  team: string;
  hpMultiplier: number;
  speedMultiplier: number;
  loadoutAbilityIds: string[];
  behavior: NpcArchetype['behavior'];
  casting: NpcArchetype['casting'];
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
  role?: ActorRole;
  team?: string;
  npc?: RuntimeNpcConfig;
  spawnPoint?: {
    x: number;
    y: number;
  };
};

export type ActorRole = 'player' | 'dummy' | 'npc';

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
  role: ActorRole;
  team: string;
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
  kind:
    | 'impact'
    | 'melee'
    | 'spawn'
    | 'death'
    | 'knockback'
    | 'slow'
    | 'dash'
    | 'heal'
    | 'status'
    | 'trigger'
    | 'resource'
    | 'physics'
    | 'snare'
    | 'drag';
  x: number;
  y: number;
  radius: number;
  color: string;
  ageTicks: number;
  lifetimeTicks: number;
};

export type PhysicsBodySnapshot = {
  bodyId: string;
  ownerId?: string;
  sourceAbilityId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  remainingTicks: number;
};

export type ConstraintSnapshot = {
  constraintId: string;
  kind: 'snare' | 'drag';
  targetId: string;
  ownerId?: string;
  sourceAbilityId?: string;
  anchorBodyId?: string;
  anchorX: number;
  anchorY: number;
  length: number;
  color: string;
  remainingTicks: number;
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

export type MechanicTraceKind = 'event' | 'trigger' | 'condition-failed' | 'action' | 'guard' | 'physics';
export type PhysicsTraceKind = 'spawnBody' | 'snare' | 'dragBody' | 'expire' | 'cleanup';

export type MechanicTraceSnapshot = {
  traceId: string;
  tick: number;
  kind: MechanicTraceKind;
  event?: MechanicEventKind;
  triggerId?: string;
  triggerName?: string;
  conditionKind?: MechanicCondition['kind'];
  actionKind?: MechanicAction['kind'];
  physicsKind?: PhysicsTraceKind;
  result: 'queued' | 'fired' | 'skipped' | 'applied' | 'blocked';
  sourceId?: string;
  sourceName?: string;
  targetId?: string;
  targetName?: string;
  abilityId?: string;
  abilityName?: string;
  statusId?: string;
  resourceId?: string;
  objectiveId?: string;
  objectiveName?: string;
  zoneId?: string;
  scoringTeamId?: string;
  amount?: number;
};

export type AiTraceKind = 'target' | 'move' | 'cast' | 'blocked';

export type AiTraceSnapshot = {
  traceId: string;
  tick: number;
  kind: AiTraceKind;
  actorId: string;
  actorName?: string;
  targetId?: string;
  targetName?: string;
  behavior?: NpcBehaviorMode;
  slot?: number;
  abilityId?: string;
  result: 'acquired' | 'none' | 'moved' | 'cast' | 'blocked';
  reason?: string;
};

export type EngineSnapshot = {
  tick: number;
  nowMs: number;
  rulesetId: string;
  match: MatchSnapshot;
  objectives: ObjectiveSnapshot[];
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  physicsBodies: PhysicsBodySnapshot[];
  constraints: ConstraintSnapshot[];
  effects: EffectSnapshot[];
  combatTexts: CombatTextSnapshot[];
  mechanicTraces: MechanicTraceSnapshot[];
  aiTraces: AiTraceSnapshot[];
};

export type MatchSnapshot = {
  elapsedTicks: number;
  remainingTicks: number;
  durationTicks: number;
  scoreLimit: number;
  finished: boolean;
  winnerTeamId?: string;
  teams: MatchTeamSnapshot[];
};

export type MatchTeamSnapshot = MatchTeam & {
  score: number;
};

export type ObjectiveSnapshot = {
  objectiveId: string;
  name: string;
  kind: ObjectiveDefinition['kind'];
  bodyId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  activeZoneId?: string;
  lastScoredTeamId?: string;
  scoreCooldownTicks: number;
  zones: ObjectiveZoneSnapshot[];
};

export type ObjectiveZoneSnapshot = {
  zoneId: string;
  team: string;
  x: number;
  y: number;
  radius: number;
  points: number;
  color: string;
};

export type EngineCommand =
  | { type: 'init'; ruleset: Ruleset; seed: number }
  | { type: 'add-player'; player: PlayerSpawn }
  | { type: 'remove-player'; playerId: string }
  | { type: 'input'; playerId: string; input: PlayerInput }
  | { type: 'set-paused'; paused: boolean }
  | { type: 'reset-objectives' }
  | { type: 'clear-trace' }
  | { type: 'stop' };

export type EngineEvent =
  | { type: 'ready'; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: EngineSnapshot }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };
