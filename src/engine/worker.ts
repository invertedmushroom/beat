import RAPIER from '@dimforge/rapier2d-compat';
import { chargeRatio, scaleAbilityForCharge } from './charge';
import { spawnPointForIndex } from './defaultRules';
import type {
  Ability,
  AbilityEffect,
  AiTraceKind,
  AiTraceSnapshot,
  CombatTextSnapshot,
  EffectSnapshot,
  EngineCommand,
  EngineEvent,
  EngineSnapshot,
  MechanicAction,
  MechanicCondition,
  MechanicDirectionRef,
  MechanicEventKind,
  MechanicPlayerRef,
  MechanicTraceSnapshot,
  MechanicTraceKind,
  MeleeAbility,
  PlayerInput,
  PlayerSpawn,
  ProjectileAbility,
  RuntimeNpcConfig,
  ProjectileSnapshot,
  Ruleset,
  StatusDefinition,
} from './protocol';

type WorkerPort = {
  postMessage: (message: EngineEvent) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<EngineCommand>) => void,
  ) => void;
};

type RuntimePlayer = {
  spawn: PlayerSpawn;
  body: RAPIER.RigidBody;
  input: PlayerInput;
  spawnSlot: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTick: number;
  cooldownUntil: Map<string, number>;
  facing: Vec2;
  team: string;
  npc?: RuntimeNpcState;
  lastUsedSlot: number;
  lastHandledInputSequence: number;
  charging?: RuntimeCharge;
  statuses: Map<string, RuntimeStatus>;
  resources: Map<string, RuntimeResource>;
};

type RuntimeProjectile = {
  projectileId: string;
  ownerId: string;
  ability: ProjectileAbility;
  x: number;
  y: number;
  dx: number;
  dy: number;
  ageTicks: number;
  traveled: number;
};

type RuntimeMelee = {
  effectId: string;
  ownerId: string;
  ability: MeleeAbility;
  dx: number;
  dy: number;
  startedTick: number;
  hitPlayers: Set<string>;
};

type RuntimeEffect = {
  effectId: string;
  kind: EffectSnapshot['kind'];
  x: number;
  y: number;
  radius: number;
  color: string;
  createdTick: number;
  lifetimeTicks: number;
};

type RuntimeCombatText = {
  textId: string;
  kind: CombatTextSnapshot['kind'];
  x: number;
  y: number;
  amount: number;
  color: string;
  createdTick: number;
  lifetimeTicks: number;
};

type RuntimeCharge = {
  slot: number;
  ability: Ability;
  startedTick: number;
  aim: Vec2;
};

type RuntimeStatus = {
  id: string;
  name: string;
  color: string;
  tags: string[];
  durationTicks: number;
  untilTick: number;
  appliedTick: number;
  stacks: number;
  maxStacks: number;
  movementMultiplier?: number;
  damageDealtMultiplier?: number;
  damageTakenMultiplier?: number;
  sourceId?: string;
  sourceAbilityId?: string;
  periodic?: StatusDefinition['periodic'];
};

type RuntimeResource = {
  id: string;
  name: string;
  color: string;
  value: number;
  max: number;
  regenPerTick: number;
};

type RuntimeNpcState = {
  config: RuntimeNpcConfig;
  targetId?: string;
  wanderSeed: number;
  lastNoTargetTraceTick: number;
  lastMoveTraceTick: number;
  lastBlockedTraceTickBySlot: Map<number, number>;
};

type MechanicEvent = {
  event: MechanicEventKind;
  sourceId?: string;
  targetId?: string;
  ability?: Ability;
  slot?: number;
  statusId?: string;
  amount?: number;
  direction?: Vec2;
};

type DamageContext = {
  source?: RuntimePlayer;
  ability?: Ability;
  slot?: number;
  direction?: Vec2;
  color?: string;
};

type StatusContext = {
  source?: RuntimePlayer;
  ability?: Ability;
  direction?: Vec2;
  durationTicks?: number;
  stacks?: number;
};

type DirectStatus = {
  id: string;
  name: string;
  color: string;
  tags?: string[];
  durationTicks: number;
  movementMultiplier?: number;
  damageDealtMultiplier?: number;
  damageTakenMultiplier?: number;
};

type Vec2 = { x: number; y: number };

const port = self as unknown as WorkerPort;
const rapierReady = initializeRapier();

let world: RAPIER.World | undefined;
let ruleset: Ruleset | undefined;
let tickHandle: number | undefined;
let tick = 0;
let spawnIndex = 0;
let projectileIndex = 0;
let effectIndex = 0;
let combatTextIndex = 0;
let traceIndex = 0;
let aiTraceIndex = 0;
let players = new Map<string, RuntimePlayer>();
let projectiles: RuntimeProjectile[] = [];
let melees: RuntimeMelee[] = [];
let effects: RuntimeEffect[] = [];
let combatTexts: RuntimeCombatText[] = [];
let mechanicEvents: MechanicEvent[] = [];
let mechanicTraces: MechanicTraceSnapshot[] = [];
let aiTraces: AiTraceSnapshot[] = [];
let processingMechanics = false;
let paused = false;

const AIM_ASSIST_CONE_DEGREES = 70;
const MAX_MECHANIC_EVENTS_PER_TICK = 48;
const MAX_MECHANIC_TRACES = 64;
const MAX_AI_TRACES = 64;
const DIRECT_SLOW_STATUS_ID = '__direct_slow';

port.addEventListener('message', (event) => {
  void dispatchCommand(event.data);
});

async function dispatchCommand(command: EngineCommand): Promise<void> {
  try {
    if (command.type === 'init') {
      await rapierReady;
    }
    handleCommand(command);
  } catch (error) {
    port.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

async function initializeRapier(): Promise<void> {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === 'string' && first.includes('deprecated parameters for the initialization function')) {
      return;
    }
    warn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = warn;
  }
  port.postMessage({ type: 'notice', message: 'Rapier2D ready' });
}

function handleCommand(command: EngineCommand): void {
  switch (command.type) {
    case 'init':
      initialize(command.ruleset);
      return;
    case 'add-player':
      addPlayer(command.player);
      return;
    case 'remove-player':
      removePlayer(command.playerId);
      return;
    case 'input':
      {
        const player = players.get(command.playerId);
        if (player) {
          player.input = command.input;
        }
      }
      return;
    case 'set-paused':
      paused = command.paused;
      return;
    case 'clear-trace':
      mechanicTraces = [];
      aiTraces = [];
      return;
    case 'stop':
      stop();
      return;
  }
}

function initialize(nextRuleset: Ruleset): void {
  stop();
  ruleset = nextRuleset;
  world = new RAPIER.World({ x: 0, y: 0 });
  tick = 0;
  spawnIndex = 0;
  projectileIndex = 0;
  effectIndex = 0;
  combatTextIndex = 0;
  traceIndex = 0;
  aiTraceIndex = 0;
  players = new Map();
  projectiles = [];
  melees = [];
  effects = [];
  combatTexts = [];
  mechanicEvents = [];
  mechanicTraces = [];
  aiTraces = [];
  processingMechanics = false;
  paused = false;

  addArenaWalls(nextRuleset);
  for (const obstacle of nextRuleset.obstacles) {
    addStaticBox(obstacle.x, obstacle.y, obstacle.halfWidth, obstacle.halfHeight);
  }

  const intervalMs = 1000 / nextRuleset.tickRate;
  tickHandle = setInterval(step, intervalMs) as unknown as number;
  port.postMessage({ type: 'ready', ruleset: nextRuleset });
}

function addArenaWalls(activeRuleset: Ruleset): void {
  const halfW = activeRuleset.arena.width / 2;
  const halfH = activeRuleset.arena.height / 2;
  const wall = 0.55;
  addStaticBox(0, -halfH - wall, halfW + wall, wall);
  addStaticBox(0, halfH + wall, halfW + wall, wall);
  addStaticBox(-halfW - wall, 0, wall, halfH + wall);
  addStaticBox(halfW + wall, 0, wall, halfH + wall);
}

function addStaticBox(x: number, y: number, halfWidth: number, halfHeight: number): void {
  if (!world) {
    return;
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y));
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight), body);
}

function addPlayer(spawn: PlayerSpawn): void {
  if (!world || !ruleset || players.has(spawn.playerId)) {
    return;
  }

  const spawnSlot = spawnIndex++;
  const point = spawn.spawnPoint ?? spawnPointForIndex(spawnSlot);
  const role = spawn.role ?? 'player';
  const team = spawn.team ?? spawn.npc?.team ?? (role === 'player' ? spawn.playerId : 'hostile');
  const maxHp = Math.max(1, Math.round(ruleset.player.maxHp * (spawn.npc?.hpMultiplier ?? 1)));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(point.x, point.y)
      .setLinearDamping(ruleset.player.damping)
      .setAngularDamping(10)
      .setCanSleep(false),
  );
  body.lockRotations(true, true);
  world.createCollider(
    RAPIER.ColliderDesc.ball(ruleset.player.radius)
      .setRestitution(0)
      .setFriction(0),
    body,
  );

  players.set(spawn.playerId, {
    spawn,
    body,
    input: neutralInput(),
    spawnSlot,
    hp: maxHp,
    maxHp,
    alive: true,
    respawnTick: 0,
    cooldownUntil: new Map(),
    facing: { x: 1, y: 0 },
    team,
    npc: spawn.npc
      ? {
          config: {
            ...spawn.npc,
            team,
          },
          wanderSeed: stableSeed(spawn.playerId),
          lastNoTargetTraceTick: -9999,
          lastMoveTraceTick: -9999,
          lastBlockedTraceTickBySlot: new Map(),
        }
      : undefined,
    lastUsedSlot: 0,
    lastHandledInputSequence: 0,
    statuses: new Map(),
    resources: initialResources(),
  });
}

function removePlayer(playerId: string): void {
  const player = players.get(playerId);
  if (!player || !world) {
    return;
  }
  world.removeRigidBody(player.body);
  players.delete(playerId);
}

function step(): void {
  if (!world || !ruleset) {
    return;
  }

  if (paused) {
    port.postMessage({ type: 'snapshot', snapshot: readSnapshot() });
    return;
  }

  for (const player of players.values()) {
    if (!player.alive && player.respawnTick <= tick) {
      respawnPlayer(player);
    }
    if (!player.alive) {
      player.charging = undefined;
      player.statuses.clear();
      player.body.setLinvel({ x: 0, y: 0 }, true);
      player.lastHandledInputSequence = player.input.sequence;
      continue;
    }
    clearExpiredStatuses(player);
    tickStatusPeriodics(player);
    regenerateResources(player);
    updateNpcInput(player);

    const hasNewInputEvents = player.input.sequence !== player.lastHandledInputSequence;
    const slotPresses = hasNewInputEvents ? player.input.slotPresses : [];
    const castSlots = hasNewInputEvents ? player.input.castSlots : [];
    const slotReleases = hasNewInputEvents ? player.input.slotReleases : [];

    for (const slot of slotPresses) {
      handleSlotPress(player, slot);
    }
    const speedMultiplier =
      (player.charging?.ability.charge?.moveSpeedMultiplier ?? 1) *
      activeMovementMultiplier(player) *
      (player.npc?.config.speedMultiplier ?? 1);
    updateMovementAndFacing(player, speedMultiplier);
    updateChargeAim(player);
    for (const slot of castSlots) {
      castSlot(player, slot);
    }
    for (const slot of slotReleases) {
      releaseCharge(player, slot);
    }
    if (player.charging && player.charging.ability.charge?.autoRelease && chargeTicks(player.charging) >= player.charging.ability.charge.maxTicks) {
      releaseActiveCharge(player);
    }
    player.lastHandledInputSequence = player.input.sequence;
  }

  world.step();
  stepProjectiles();
  stepMelees();
  pruneEffects();
  pruneCombatTexts();
  tick += 1;
  port.postMessage({ type: 'snapshot', snapshot: readSnapshot() });
}

function castSlot(player: RuntimePlayer, slot: number): void {
  const ability = abilityForPlayerSlot(player, slot);
  if (!ability || (player.cooldownUntil.get(ability.id) ?? 0) > tick) {
    return;
  }
  player.lastUsedSlot = slot;
  if (ability.charge) {
    return;
  }
  player.cooldownUntil.set(ability.id, tick + ability.cooldownTicks);
  const aim = aimForAbility(player, ability);
  spawnAbility(player, ability, aim);
}

function handleSlotPress(player: RuntimePlayer, slot: number): void {
  const ability = abilityForPlayerSlot(player, slot);
  if (!ability) {
    return;
  }
  player.lastUsedSlot = slot;
  if (!ability.charge || player.charging || (player.cooldownUntil.get(ability.id) ?? 0) > tick) {
    return;
  }
  player.charging = {
    slot,
    ability,
    startedTick: tick,
    aim: aimForAbility(player, ability),
  };
}

function releaseCharge(player: RuntimePlayer, slot: number): void {
  if (!player.charging || player.charging.slot !== slot) {
    return;
  }
  releaseActiveCharge(player);
}

function releaseActiveCharge(player: RuntimePlayer): void {
  const charge = player.charging;
  if (!charge) {
    return;
  }
  updateChargeAim(player);
  const ability = scaleAbilityForCharge(charge.ability, chargeRatio(chargeTicks(charge), charge.ability.charge?.maxTicks ?? 1));
  player.cooldownUntil.set(charge.ability.id, tick + charge.ability.cooldownTicks);
  player.lastUsedSlot = charge.slot;
  player.charging = undefined;
  const pos = player.body.translation();
  addEffect('impact', pos.x, pos.y, (ruleset?.player.radius ?? 0.5) * 3.2, charge.ability.color, 24);
  spawnAbility(player, ability, charge.aim);
}

function spawnAbility(player: RuntimePlayer, ability: Ability, aim: Vec2): void {
  applySelfEffects(player, ability, aim);
  emitMechanicEvent({
    event: 'onCast',
    sourceId: player.spawn.playerId,
    targetId: player.spawn.playerId,
    ability,
    slot: player.lastUsedSlot,
    direction: aim,
  });
  if (ability.shape === 'projectile') {
    spawnProjectile(player, ability, aim);
  } else {
    spawnMelee(player, ability, aim);
  }
}

function abilityForPlayerSlot(player: RuntimePlayer, slot: number): Ability | undefined {
  const activeRuleset = ruleset;
  const abilityIds = abilityIdsForPlayer(player);
  if (!activeRuleset || !Number.isInteger(slot) || slot < 0 || slot >= abilityIds.length) {
    return undefined;
  }
  const abilityId = abilityIds[slot];
  return activeRuleset.abilities.find((candidate) => candidate.id === abilityId);
}

function abilityIdsForPlayer(player: RuntimePlayer): string[] {
  return player.npc?.config.loadoutAbilityIds ?? ruleset?.loadout.abilityIds ?? [];
}

function updateNpcInput(player: RuntimePlayer): void {
  const npc = player.npc;
  if (!npc || !ruleset) {
    return;
  }
  const behavior = npc.config.behavior;
  const baseInput = neutralInput();
  baseInput.sequence = player.input.sequence + 1;
  if (behavior.mode === 'idle') {
    player.input = baseInput;
    return;
  }

  const target = findNpcTarget(player);
  if (target?.spawn.playerId !== npc.targetId) {
    npc.targetId = target?.spawn.playerId;
    if (target) {
      addAiTrace('target', 'acquired', player, {
        targetId: target.spawn.playerId,
        targetName: target.spawn.displayName,
        behavior: behavior.mode,
      });
    }
  }
  if (!target) {
    if (tick - npc.lastNoTargetTraceTick >= Math.max(30, ruleset.tickRate)) {
      npc.lastNoTargetTraceTick = tick;
      addAiTrace('target', 'none', player, {
        behavior: behavior.mode,
        reason: 'no enemy in aggro range',
      });
    }
    const wander = behavior.mode === 'wander' ? npcWanderMove(player) : undefined;
    if (wander) {
      baseInput.moveX = wander.x;
      baseInput.moveY = wander.y;
      baseInput.aimDx = wander.x;
      baseInput.aimDy = wander.y;
      traceNpcMove(player, undefined, behavior.mode);
    }
    player.input = baseInput;
    return;
  }

  const origin = player.body.translation();
  const targetPos = target.body.translation();
  const dx = targetPos.x - origin.x;
  const dy = targetPos.y - origin.y;
  const distance = Math.hypot(dx, dy);
  const aim = normalized(dx, dy) ?? player.facing;
  const move = npcMoveForBehavior(player, target, distance, aim);
  baseInput.aimDx = aim.x;
  baseInput.aimDy = aim.y;
  if (move) {
    baseInput.moveX = move.x;
    baseInput.moveY = move.y;
    traceNpcMove(player, target, behavior.mode);
  }

  const cast = chooseNpcCast(player, target, distance);
  if (cast) {
    if (cast.ability.charge) {
      if (!player.charging) {
        baseInput.slotPresses = [cast.slot];
        addAiTrace('cast', 'cast', player, {
          targetId: target.spawn.playerId,
          targetName: target.spawn.displayName,
          behavior: behavior.mode,
          slot: cast.slot,
          abilityId: cast.ability.id,
        });
      }
    } else {
      baseInput.castSlots = [cast.slot];
      addAiTrace('cast', 'cast', player, {
        targetId: target.spawn.playerId,
        targetName: target.spawn.displayName,
        behavior: behavior.mode,
        slot: cast.slot,
        abilityId: cast.ability.id,
      });
    }
  }
  player.input = baseInput;
}

function findNpcTarget(actor: RuntimePlayer): RuntimePlayer | undefined {
  const aggroRange = actor.npc?.config.behavior.aggroRange ?? 0;
  if (aggroRange <= 0) {
    return undefined;
  }
  const origin = actor.body.translation();
  let best: { player: RuntimePlayer; distance: number } | undefined;
  for (const candidate of players.values()) {
    if (candidate.spawn.playerId === actor.spawn.playerId || !candidate.alive || sameTeam(actor, candidate)) {
      continue;
    }
    const pos = candidate.body.translation();
    const distance = Math.hypot(pos.x - origin.x, pos.y - origin.y);
    if (distance > aggroRange) {
      continue;
    }
    if (!best || distance < best.distance || (distance === best.distance && candidate.spawn.playerId < best.player.spawn.playerId)) {
      best = { player: candidate, distance };
    }
  }
  return best?.player;
}

function npcMoveForBehavior(player: RuntimePlayer, target: RuntimePlayer, distance: number, aim: Vec2): Vec2 | undefined {
  const behavior = player.npc?.config.behavior;
  if (!behavior) {
    return undefined;
  }
  if (behavior.mode === 'seek') {
    return distance > Math.max(0.5, behavior.preferredRange * 0.8) ? aim : undefined;
  }
  if (behavior.mode === 'kite') {
    if (distance < Math.max(0.5, behavior.preferredRange * 0.85)) {
      return { x: -aim.x, y: -aim.y };
    }
    if (distance > behavior.preferredRange * 1.18) {
      return aim;
    }
    return undefined;
  }
  if (behavior.mode === 'wander') {
    return npcWanderMove(player);
  }
  return undefined;
}

function npcWanderMove(player: RuntimePlayer): Vec2 | undefined {
  const npc = player.npc;
  const radius = npc?.config.behavior.wanderRadius ?? 0;
  if (!npc || radius <= 0) {
    return undefined;
  }
  const pos = player.body.translation();
  const anchor = player.spawn.spawnPoint ?? spawnPointForIndex(player.spawnSlot);
  const homeDx = anchor.x - pos.x;
  const homeDy = anchor.y - pos.y;
  const homeDistance = Math.hypot(homeDx, homeDy);
  if (homeDistance > radius) {
    return normalized(homeDx, homeDy);
  }
  const phase = (tick + npc.wanderSeed) / 32;
  return normalized(Math.cos(phase), Math.sin(phase * 0.73 + npc.wanderSeed * 0.01));
}

function chooseNpcCast(player: RuntimePlayer, target: RuntimePlayer, distance: number): { slot: number; ability: Ability } | undefined {
  const npc = player.npc;
  if (!npc) {
    return undefined;
  }
  for (const slot of npc.config.casting.slots) {
    const ability = abilityForPlayerSlot(player, slot);
    if (!ability) {
      traceNpcBlockedCast(player, slot, undefined, 'empty slot');
      continue;
    }
    if ((player.cooldownUntil.get(ability.id) ?? 0) > tick || (player.charging && player.charging.slot !== slot)) {
      traceNpcBlockedCast(player, slot, ability.id, 'cooldown');
      continue;
    }
    if (distance < npc.config.casting.minRange || distance > npc.config.casting.maxRange) {
      traceNpcBlockedCast(player, slot, ability.id, 'range');
      continue;
    }
    if (ability.shape === 'melee' && distance > ability.range + (ruleset?.player.radius ?? 0.5) + 0.35) {
      traceNpcBlockedCast(player, slot, ability.id, 'melee range');
      continue;
    }
    if (ability.charge && player.charging) {
      continue;
    }
    return { slot, ability };
  }
  return undefined;
}

function traceNpcMove(player: RuntimePlayer, target: RuntimePlayer | undefined, behavior: RuntimeNpcConfig['behavior']['mode']): void {
  const npc = player.npc;
  if (!npc || !ruleset || tick - npc.lastMoveTraceTick < Math.max(20, ruleset.tickRate)) {
    return;
  }
  npc.lastMoveTraceTick = tick;
  addAiTrace('move', 'moved', player, {
    targetId: target?.spawn.playerId,
    targetName: target?.spawn.displayName,
    behavior,
  });
}

function traceNpcBlockedCast(player: RuntimePlayer, slot: number, abilityId: string | undefined, reason: string): void {
  const npc = player.npc;
  if (!npc || !ruleset) {
    return;
  }
  const last = npc.lastBlockedTraceTickBySlot.get(slot) ?? -9999;
  if (tick - last < Math.max(18, ruleset.tickRate)) {
    return;
  }
  npc.lastBlockedTraceTickBySlot.set(slot, tick);
  addAiTrace('blocked', 'blocked', player, {
    behavior: npc.config.behavior.mode,
    slot,
    abilityId,
    reason,
  });
}

function addAiTrace(
  kind: AiTraceKind,
  result: AiTraceSnapshot['result'],
  actor: RuntimePlayer,
  extra: Partial<Omit<AiTraceSnapshot, 'traceId' | 'tick' | 'kind' | 'result' | 'actorId' | 'actorName'>> = {},
): void {
  aiTraces.push({
    traceId: `ai-${++aiTraceIndex}`,
    tick,
    kind,
    actorId: actor.spawn.playerId,
    actorName: actor.spawn.displayName,
    result,
    ...extra,
  });
  if (aiTraces.length > MAX_AI_TRACES) {
    aiTraces = aiTraces.slice(-MAX_AI_TRACES);
  }
}

function spawnProjectile(player: RuntimePlayer, ability: ProjectileAbility, aim: Vec2): void {
  const pos = player.body.translation();
  projectiles.push({
    projectileId: `proj-${++projectileIndex}`,
    ownerId: player.spawn.playerId,
    ability,
    x: pos.x + aim.x * (ruleset?.player.radius ?? 0.5),
    y: pos.y + aim.y * (ruleset?.player.radius ?? 0.5),
    dx: aim.x,
    dy: aim.y,
    ageTicks: 0,
    traveled: 0,
  });
}

function spawnMelee(player: RuntimePlayer, ability: MeleeAbility, aim: Vec2): void {
  const pos = player.body.translation();
  melees.push({
    effectId: `melee-${++effectIndex}`,
    ownerId: player.spawn.playerId,
    ability,
    dx: aim.x,
    dy: aim.y,
    startedTick: tick,
    hitPlayers: new Set(),
  });
  effects.push({
    effectId: `melee-windup-${effectIndex}`,
    kind: 'melee',
    x: pos.x + aim.x * ability.range * 0.55,
    y: pos.y + aim.y * ability.range * 0.55,
    radius: ability.range,
    color: ability.color,
    createdTick: tick,
    lifetimeTicks: ability.windupTicks + ability.activeTicks + 5,
  });
}

function stepProjectiles(): void {
  if (!ruleset) {
    return;
  }
  const next: RuntimeProjectile[] = [];
  for (const projectile of projectiles) {
    const from = { x: projectile.x, y: projectile.y };
    const stepDistance = projectile.ability.speed;
    const to = {
      x: projectile.x + projectile.dx * stepDistance,
      y: projectile.y + projectile.dy * stepDistance,
    };
    projectile.x = to.x;
    projectile.y = to.y;
    projectile.ageTicks += 1;
    projectile.traveled += stepDistance;

    const hitPlayer = findProjectileHit(projectile, from, to);
    if (hitPlayer) {
      const owner = players.get(projectile.ownerId);
      const direction = { x: projectile.dx, y: projectile.dy };
      damagePlayer(hitPlayer, projectile.ability.damage, {
        source: owner,
        ability: projectile.ability,
        direction,
      });
      addImpact(to.x, to.y, projectile.ability.radius * 3.4, projectile.ability.color);
      if (hitPlayer.alive) {
        applyHitEffects(projectile.ability, owner, hitPlayer, direction);
      }
      emitMechanicEvent({
        event: 'onHit',
        sourceId: projectile.ownerId,
        targetId: hitPlayer.spawn.playerId,
        ability: projectile.ability,
        direction,
      });
      continue;
    }
    if (
      projectile.ageTicks >= projectile.ability.lifetimeTicks ||
      projectile.traveled >= projectile.ability.range ||
      hitsArenaOrObstacle(to, projectile.ability.radius)
    ) {
      addImpact(to.x, to.y, projectile.ability.radius * 2.8, projectile.ability.color);
      continue;
    }
    next.push(projectile);
  }
  projectiles = next;
}

function stepMelees(): void {
  const next: RuntimeMelee[] = [];
  for (const melee of melees) {
    const age = tick - melee.startedTick;
    const active = age >= melee.ability.windupTicks && age < melee.ability.windupTicks + melee.ability.activeTicks;
    const owner = players.get(melee.ownerId);
    if (active && owner?.alive) {
      const ownerPos = owner.body.translation();
      for (const target of players.values()) {
        if (target.spawn.playerId === melee.ownerId || !target.alive || melee.hitPlayers.has(target.spawn.playerId) || sameTeam(owner, target)) {
          continue;
        }
        const targetPos = target.body.translation();
        const dx = targetPos.x - ownerPos.x;
        const dy = targetPos.y - ownerPos.y;
        const distance = Math.hypot(dx, dy);
        const reach = melee.ability.range + (ruleset?.player.radius ?? 0.5);
        if (distance > reach) {
          continue;
        }
        const dot = distance > 0 ? (dx / distance) * melee.dx + (dy / distance) * melee.dy : 1;
        const minDot = Math.cos((melee.ability.arcDegrees * Math.PI) / 360);
        if (dot >= minDot) {
          melee.hitPlayers.add(target.spawn.playerId);
          const direction = normalized(dx, dy) ?? { x: melee.dx, y: melee.dy };
          damagePlayer(target, melee.ability.damage, {
            source: owner,
            ability: melee.ability,
            direction,
          });
          addImpact(targetPos.x, targetPos.y, melee.ability.radius, melee.ability.color);
          if (target.alive) {
            applyHitEffects(melee.ability, owner, target, direction);
          }
          emitMechanicEvent({
            event: 'onHit',
            sourceId: melee.ownerId,
            targetId: target.spawn.playerId,
            ability: melee.ability,
            direction,
          });
        }
      }
    }
    if (age < melee.ability.windupTicks + melee.ability.activeTicks) {
      next.push(melee);
    }
  }
  melees = next;
}

function damagePlayer(player: RuntimePlayer, damage: number, context: DamageContext = {}): void {
  if (!ruleset || !player.alive) {
    return;
  }
  if (context.source && sameTeam(context.source, player)) {
    return;
  }
  const pos = player.body.translation();
  const finalDamage = Math.max(0, damage * damageDealtMultiplier(context.source) * damageTakenMultiplier(player));
  if (finalDamage <= 0) {
    return;
  }
  player.hp = Math.max(0, player.hp - finalDamage);
  addCombatText(pos.x, pos.y - ruleset.player.radius * 1.8, 'damage', finalDamage, context.color ?? '#ffd166');
  emitMechanicEvent({
    event: 'onDamageTaken',
    sourceId: context.source?.spawn.playerId,
    targetId: player.spawn.playerId,
    ability: context.ability,
    slot: context.slot,
    amount: finalDamage,
    direction: context.direction,
  });
  if (player.hp > 0) {
    if (player.hp / player.maxHp <= 0.35) {
      emitMechanicEvent({
        event: 'onLowHp',
        sourceId: context.source?.spawn.playerId,
        targetId: player.spawn.playerId,
        ability: context.ability,
        slot: context.slot,
        amount: finalDamage,
        direction: context.direction,
      });
    }
    return;
  }
  player.charging = undefined;
  player.statuses.clear();
  player.alive = false;
  player.respawnTick = tick + ruleset.player.respawnTicks;
  player.body.setLinvel({ x: 0, y: 0 }, true);
  player.body.setEnabled(false);
  addEffect('death', pos.x, pos.y, ruleset.player.radius * 5, '#ffffff', 28);
  emitMechanicEvent({
    event: 'onKill',
    sourceId: context.source?.spawn.playerId,
    targetId: player.spawn.playerId,
    ability: context.ability,
    slot: context.slot,
    amount: finalDamage,
    direction: context.direction,
  });
}

function respawnPlayer(player: RuntimePlayer): void {
  if (!ruleset) {
    return;
  }
  const point = player.spawn.spawnPoint ?? spawnPointForIndex(player.spawnSlot);
  player.hp = player.maxHp;
  player.alive = true;
  player.respawnTick = 0;
  player.statuses.clear();
  player.resources = initialResources();
  player.cooldownUntil.clear();
  player.body.setEnabled(true);
  player.body.setTranslation(point, true);
  player.body.setLinvel({ x: 0, y: 0 }, true);
  effects.push({
    effectId: `spawn-${++effectIndex}`,
    kind: 'spawn',
    x: point.x,
    y: point.y,
    radius: ruleset.player.radius * 3.4,
    color: '#2fd17c',
    createdTick: tick,
    lifetimeTicks: 24,
  });
}

function applySelfEffects(player: RuntimePlayer, ability: Ability, aim: Vec2): void {
  for (const effect of ability.effects ?? []) {
    if (effect.kind === 'heal' && effect.target === 'self') {
      healPlayer(player, effect.amount);
    }
    if (effect.kind === 'selfDash') {
      dashPlayer(player, aim, effect.distance, ability.color);
    }
    if (effect.kind === 'applyStatus' && effect.target === 'self') {
      applyNamedStatus(player, effect.statusId, {
        source: player,
        ability,
        direction: aim,
        durationTicks: effect.durationTicks,
        stacks: effect.stacks,
      });
    }
  }
}

function applyHitEffects(ability: Ability, source: RuntimePlayer | undefined, target: RuntimePlayer, direction: Vec2): void {
  for (const effect of ability.effects ?? []) {
    applyHitEffect(effect, ability, source, target, direction, ability.color);
  }
}

function applyHitEffect(effect: AbilityEffect, ability: Ability, source: RuntimePlayer | undefined, target: RuntimePlayer, direction: Vec2, color: string): void {
  if (effect.kind === 'knockback') {
    knockbackPlayer(target, direction, effect.force, color);
    return;
  }
  if (effect.kind === 'slow') {
    slowPlayer(target, effect.multiplier, effect.durationTicks, color);
    return;
  }
  if (effect.kind === 'heal' && effect.target === 'hit') {
    healPlayer(target, effect.amount);
  }
  if (effect.kind === 'applyStatus' && effect.target === 'hit') {
    applyNamedStatus(target, effect.statusId, {
      source,
      ability,
      direction,
      durationTicks: effect.durationTicks,
      stacks: effect.stacks,
    });
  }
}

function dashPlayer(player: RuntimePlayer, direction: Vec2, distance: number, color: string): void {
  const moved = movePlayerSafely(player, direction, distance);
  if (moved <= 0 || !ruleset) {
    return;
  }
  const pos = player.body.translation();
  addEffect('dash', pos.x, pos.y, ruleset.player.radius * 3.1, color, 16);
}

function knockbackPlayer(player: RuntimePlayer, direction: Vec2, force: number, color: string): void {
  const moved = movePlayerSafely(player, direction, force);
  if (moved <= 0 || !ruleset) {
    return;
  }
  const pos = player.body.translation();
  addEffect('knockback', pos.x, pos.y, ruleset.player.radius * 2.8, color, 16);
}

function slowPlayer(player: RuntimePlayer, multiplier: number, durationTicks: number, color: string): void {
  if (!player.alive || !ruleset) {
    return;
  }
  applyDirectStatus(player, {
    id: DIRECT_SLOW_STATUS_ID,
    name: 'Slow',
    color,
    tags: ['slow'],
    durationTicks,
    movementMultiplier: multiplier,
  });
  const pos = player.body.translation();
  addEffect('slow', pos.x, pos.y, ruleset.player.radius * 2.5, color, Math.min(34, Math.max(14, durationTicks)));
}

function healPlayer(player: RuntimePlayer, amount: number): void {
  if (!player.alive || !ruleset || amount <= 0) {
    return;
  }
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + amount);
  const healed = player.hp - before;
  if (healed <= 0) {
    return;
  }
  const pos = player.body.translation();
  addCombatText(pos.x, pos.y - ruleset.player.radius * 1.8, 'heal', healed, '#2fd17c');
  addEffect('heal', pos.x, pos.y, ruleset.player.radius * 2.7, '#2fd17c', 18);
}

function initialResources(): Map<string, RuntimeResource> {
  const resources = new Map<string, RuntimeResource>();
  for (const resource of ruleset?.mechanics.resources ?? []) {
    resources.set(resource.id, {
      id: resource.id,
      name: resource.name,
      color: resource.color,
      value: resource.start,
      max: resource.max,
      regenPerTick: resource.regenPerTick,
    });
  }
  return resources;
}

function applyNamedStatus(player: RuntimePlayer, statusId: string, context: StatusContext = {}): void {
  const definition = ruleset?.mechanics.statuses.find((status) => status.id === statusId);
  if (!definition) {
    return;
  }
  applyRuntimeStatus(
    player,
    {
      id: definition.id,
      name: definition.name,
      color: definition.color,
      tags: definition.tags,
      durationTicks: context.durationTicks ?? definition.durationTicks,
      movementMultiplier: definition.movementMultiplier,
      damageDealtMultiplier: definition.damageDealtMultiplier,
      damageTakenMultiplier: definition.damageTakenMultiplier,
    },
    {
      ...context,
      stacks: context.stacks ?? 1,
    },
    definition,
  );
}

function applyDirectStatus(player: RuntimePlayer, status: DirectStatus, context: StatusContext = {}): void {
  applyRuntimeStatus(player, status, context);
}

function applyRuntimeStatus(player: RuntimePlayer, status: DirectStatus, context: StatusContext, definition?: StatusDefinition): void {
  if (!player.alive || !ruleset) {
    return;
  }
  const existing = player.statuses.get(status.id);
  const maxStacks = definition?.maxStacks ?? 1;
  const stackMode = definition?.stacking ?? 'refresh';
  const incomingStacks = clamp(Math.floor(context.stacks ?? 1), 1, maxStacks);
  const stacks =
    existing && stackMode === 'stack'
      ? clamp(existing.stacks + incomingStacks, 1, maxStacks)
      : existing
        ? clamp(Math.max(existing.stacks, incomingStacks), 1, maxStacks)
        : incomingStacks;
  const durationTicks = context.durationTicks ?? status.durationTicks;
  const nextStatus: RuntimeStatus = {
    id: status.id,
    name: status.name,
    color: status.color,
    tags: status.tags ?? [],
    durationTicks,
    untilTick: tick + durationTicks,
    appliedTick: tick,
    stacks,
    maxStacks,
    movementMultiplier:
      existing?.movementMultiplier !== undefined && status.movementMultiplier !== undefined
        ? Math.min(existing.movementMultiplier, status.movementMultiplier)
        : status.movementMultiplier ?? existing?.movementMultiplier,
    damageDealtMultiplier: status.damageDealtMultiplier ?? existing?.damageDealtMultiplier,
    damageTakenMultiplier: status.damageTakenMultiplier ?? existing?.damageTakenMultiplier,
    sourceId: context.source?.spawn.playerId ?? existing?.sourceId,
    sourceAbilityId: context.ability?.id ?? existing?.sourceAbilityId,
    periodic: definition?.periodic ?? existing?.periodic,
  };
  player.statuses.set(status.id, nextStatus);
  const pos = player.body.translation();
  addEffect('status', pos.x, pos.y, ruleset.player.radius * (2.1 + stacks * 0.28), status.color, 18);
  emitMechanicEvent({
    event: 'onStatusApplied',
    sourceId: nextStatus.sourceId,
    targetId: player.spawn.playerId,
    ability: context.ability,
    statusId: status.id,
    direction: context.direction,
  });
}

function removeStatus(player: RuntimePlayer, statusId: string): void {
  const removed = player.statuses.get(statusId);
  if (!removed) {
    return;
  }
  player.statuses.delete(statusId);
  const pos = player.body.translation();
  addEffect('status', pos.x, pos.y, (ruleset?.player.radius ?? 0.5) * 1.9, removed.color, 14);
}

function modifyResource(player: RuntimePlayer, resourceId: string, amount: number): void {
  if (!player.alive || !ruleset || amount === 0) {
    return;
  }
  const resource = player.resources.get(resourceId);
  if (!resource) {
    return;
  }
  const before = resource.value;
  resource.value = clamp(resource.value + amount, 0, resource.max);
  const changed = resource.value - before;
  if (Math.abs(changed) < 0.001) {
    return;
  }
  const pos = player.body.translation();
  addCombatText(pos.x, pos.y - ruleset.player.radius * 2.35, 'resource', changed, resource.color);
  addEffect('resource', pos.x, pos.y, ruleset.player.radius * 2.3, resource.color, 16);
}

function emitMechanicEvent(event: MechanicEvent): void {
  if (!ruleset) {
    return;
  }
  addMechanicTrace('event', 'queued', event);
  if (ruleset.mechanics.triggers.length === 0) {
    return;
  }
  mechanicEvents.push(event);
  if (!processingMechanics) {
    processMechanicEvents();
  }
}

function processMechanicEvents(): void {
  if (!ruleset) {
    return;
  }
  processingMechanics = true;
  let processed = 0;
  while (mechanicEvents.length > 0 && processed < MAX_MECHANIC_EVENTS_PER_TICK) {
    processed += 1;
    const event = mechanicEvents.shift();
    if (!event) {
      continue;
    }
    const source = event.sourceId ? players.get(event.sourceId) : undefined;
    const target = event.targetId ? players.get(event.targetId) : undefined;
    for (const trigger of ruleset.mechanics.triggers) {
      if (trigger.event !== event.event) {
        continue;
      }
      const failedCondition = firstFailedCondition(trigger.conditions ?? [], event, source, target);
      if (failedCondition) {
        addMechanicTrace('condition-failed', 'skipped', event, {
          triggerId: trigger.id,
          triggerName: trigger.name,
          conditionKind: failedCondition.kind,
        });
        continue;
      }
      addMechanicTrace('trigger', 'fired', event, {
        triggerId: trigger.id,
        triggerName: trigger.name,
      });
      for (const action of trigger.actions) {
        addMechanicTrace('action', 'applied', event, {
          triggerId: trigger.id,
          triggerName: trigger.name,
          actionKind: action.kind,
          statusId: 'statusId' in action ? action.statusId : event.statusId,
          resourceId: 'resourceId' in action ? action.resourceId : undefined,
          amount: 'amount' in action ? action.amount : undefined,
        });
        applyMechanicAction(action, event, source, target);
      }
    }
  }
  if (processed >= MAX_MECHANIC_EVENTS_PER_TICK) {
    mechanicEvents = [];
    addMechanicTrace('guard', 'blocked', {
      event: 'onCast',
    });
    port.postMessage({ type: 'notice', message: 'mechanics trigger loop guard cleared queued events' });
  }
  processingMechanics = false;
}

function addMechanicTrace(
  kind: MechanicTraceKind,
  result: MechanicTraceSnapshot['result'],
  event: MechanicEvent,
  extra: Partial<Omit<MechanicTraceSnapshot, 'traceId' | 'tick' | 'kind' | 'result' | 'event'>> = {},
): void {
  const source = event.sourceId ? players.get(event.sourceId) : undefined;
  const target = event.targetId ? players.get(event.targetId) : undefined;
  mechanicTraces.push({
    traceId: `trace-${++traceIndex}`,
    tick,
    kind,
    event: event.event,
    result,
    sourceId: event.sourceId,
    sourceName: source?.spawn.displayName,
    targetId: event.targetId,
    targetName: target?.spawn.displayName,
    abilityId: event.ability?.id,
    abilityName: event.ability?.name,
    statusId: event.statusId,
    amount: event.amount,
    ...extra,
  });
  if (mechanicTraces.length > MAX_MECHANIC_TRACES) {
    mechanicTraces = mechanicTraces.slice(-MAX_MECHANIC_TRACES);
  }
}

function firstFailedCondition(
  conditions: MechanicCondition[],
  event: MechanicEvent,
  source: RuntimePlayer | undefined,
  target: RuntimePlayer | undefined,
): MechanicCondition | undefined {
  for (const condition of conditions) {
    if (!conditionPasses(condition, event, source, target)) {
      return condition;
    }
  }
  return undefined;
}

function conditionPasses(condition: MechanicCondition, event: MechanicEvent, source: RuntimePlayer | undefined, target: RuntimePlayer | undefined): boolean {
  if (condition.kind === 'abilityTag') {
    return Boolean(event.ability?.tags?.includes(condition.tag));
  }
  if (condition.kind === 'slotUsed') {
    return event.slot === condition.slot;
  }
  const player = playerForRef(condition.target, source, target);
  if (!player) {
    return false;
  }
  if (condition.kind === 'hasStatus') {
    return player.statuses.has(condition.statusId);
  }
  if (condition.kind === 'missingStatus') {
    return !player.statuses.has(condition.statusId);
  }
  if (condition.kind === 'hpBelow') {
    return player.hp / player.maxHp <= condition.ratio;
  }
  if (condition.kind === 'resourceAtLeast') {
    return (player.resources.get(condition.resourceId)?.value ?? 0) >= condition.amount;
  }
  return false;
}

function applyMechanicAction(
  action: MechanicAction,
  event: MechanicEvent,
  source: RuntimePlayer | undefined,
  target: RuntimePlayer | undefined,
): void {
  const player = playerForRef(action.target, source, target);
  if (!player) {
    return;
  }
  const color = action.kind === 'knockback' || action.kind === 'slow' || action.kind === 'flashEffect' || action.kind === 'dealDamage' ? action.color : undefined;
  if (action.kind === 'applyStatus') {
    applyNamedStatus(player, action.statusId, {
      source,
      ability: event.ability,
      direction: event.direction,
      durationTicks: action.durationTicks,
      stacks: action.stacks,
    });
    return;
  }
  if (action.kind === 'removeStatus') {
    removeStatus(player, action.statusId);
    return;
  }
  if (action.kind === 'dealDamage') {
    damagePlayer(player, action.amount, {
      source,
      ability: event.ability,
      slot: event.slot,
      direction: directionForAction(undefined, event, source, target),
      color: color ?? '#ffd166',
    });
    return;
  }
  if (action.kind === 'heal') {
    healPlayer(player, action.amount);
    return;
  }
  if (action.kind === 'knockback') {
    knockbackPlayer(player, directionForAction(action.direction, event, source, target), action.force, color ?? event.ability?.color ?? '#f5f3ed');
    return;
  }
  if (action.kind === 'slow') {
    slowPlayer(player, action.multiplier, action.durationTicks, color ?? event.ability?.color ?? '#62d2ff');
    return;
  }
  if (action.kind === 'modifyResource') {
    modifyResource(player, action.resourceId, action.amount);
    return;
  }
  if (action.kind === 'flashEffect') {
    const pos = player.body.translation();
    addEffect('trigger', pos.x, pos.y, action.radius, color ?? event.ability?.color ?? '#f5f3ed', 18);
  }
}

function playerForRef(ref: MechanicPlayerRef, source: RuntimePlayer | undefined, target: RuntimePlayer | undefined): RuntimePlayer | undefined {
  return ref === 'source' ? source : target;
}

function directionForAction(
  direction: MechanicDirectionRef | undefined,
  event: MechanicEvent,
  source: RuntimePlayer | undefined,
  target: RuntimePlayer | undefined,
): Vec2 {
  if (direction === 'aim' && event.direction) {
    return event.direction;
  }
  if ((direction === 'sourceToTarget' || direction === undefined) && source && target) {
    const sourcePos = source.body.translation();
    const targetPos = target.body.translation();
    return normalized(targetPos.x - sourcePos.x, targetPos.y - sourcePos.y) ?? event.direction ?? { x: 1, y: 0 };
  }
  if (direction === 'targetToSource' && source && target) {
    const sourcePos = source.body.translation();
    const targetPos = target.body.translation();
    return normalized(sourcePos.x - targetPos.x, sourcePos.y - targetPos.y) ?? event.direction ?? { x: 1, y: 0 };
  }
  return event.direction ?? source?.facing ?? { x: 1, y: 0 };
}

function movePlayerSafely(player: RuntimePlayer, direction: Vec2, distance: number): number {
  if (!ruleset || !player.alive) {
    return 0;
  }
  const unit = normalized(direction.x, direction.y);
  if (!unit) {
    return 0;
  }
  const radius = ruleset.player.radius;
  const stepDistance = Math.max(0.08, radius * 0.45);
  let remaining = clamp(distance, 0, 12);
  let moved = 0;
  const start = player.body.translation();
  let current: Vec2 = { x: start.x, y: start.y };
  while (remaining > 0.001) {
    const nextDistance = Math.min(stepDistance, remaining);
    const candidate = {
      x: current.x + unit.x * nextDistance,
      y: current.y + unit.y * nextDistance,
    };
    if (hitsArenaOrObstacle(candidate, radius)) {
      break;
    }
    current = candidate;
    moved += nextDistance;
    remaining -= nextDistance;
  }
  if (moved > 0) {
    player.body.setTranslation(current, true);
  }
  return moved;
}

function findProjectileHit(projectile: RuntimeProjectile, from: Vec2, to: Vec2): RuntimePlayer | undefined {
  const playerRadius = ruleset?.player.radius ?? 0.5;
  const owner = players.get(projectile.ownerId);
  for (const player of players.values()) {
    if (player.spawn.playerId === projectile.ownerId || !player.alive || sameTeam(owner, player)) {
      continue;
    }
    const pos = player.body.translation();
    const distance = distancePointToSegment({ x: pos.x, y: pos.y }, from, to);
    if (distance <= playerRadius + projectile.ability.radius) {
      return player;
    }
  }
  return undefined;
}

function hitsArenaOrObstacle(point: Vec2, radius: number): boolean {
  if (!ruleset) {
    return true;
  }
  const halfW = ruleset.arena.width / 2;
  const halfH = ruleset.arena.height / 2;
  if (point.x < -halfW + radius || point.x > halfW - radius || point.y < -halfH + radius || point.y > halfH - radius) {
    return true;
  }
  return ruleset.obstacles.some(
    (obstacle) =>
      point.x >= obstacle.x - obstacle.halfWidth - radius &&
      point.x <= obstacle.x + obstacle.halfWidth + radius &&
      point.y >= obstacle.y - obstacle.halfHeight - radius &&
      point.y <= obstacle.y + obstacle.halfHeight + radius,
  );
}

function addImpact(x: number, y: number, radius: number, color: string): void {
  addEffect('impact', x, y, radius, color, 14);
}

function addEffect(kind: EffectSnapshot['kind'], x: number, y: number, radius: number, color: string, lifetimeTicks: number): void {
  effects.push({
    effectId: `${kind}-${++effectIndex}`,
    kind,
    x,
    y,
    radius,
    color,
    createdTick: tick,
    lifetimeTicks,
  });
}

function pruneEffects(): void {
  effects = effects.filter((effect) => tick - effect.createdTick < effect.lifetimeTicks);
}

function addCombatText(x: number, y: number, kind: CombatTextSnapshot['kind'], amount: number, color: string): void {
  combatTexts.push({
    textId: `${kind}-${++combatTextIndex}`,
    kind,
    x,
    y,
    amount,
    color,
    createdTick: tick,
    lifetimeTicks: 28,
  });
}

function pruneCombatTexts(): void {
  combatTexts = combatTexts.filter((text) => tick - text.createdTick < text.lifetimeTicks);
}

function clearExpiredStatuses(player: RuntimePlayer): void {
  for (const status of Array.from(player.statuses.values())) {
    if (status.untilTick > tick) {
      continue;
    }
    player.statuses.delete(status.id);
    emitMechanicEvent({
      event: 'onStatusExpired',
      sourceId: status.sourceId,
      targetId: player.spawn.playerId,
      statusId: status.id,
    });
  }
}

function tickStatusPeriodics(player: RuntimePlayer): void {
  for (const status of player.statuses.values()) {
    if (!status.periodic || status.untilTick <= tick) {
      continue;
    }
    const elapsed = tick - status.appliedTick;
    if (elapsed <= 0 || elapsed % status.periodic.everyTicks !== 0) {
      continue;
    }
    const source = status.sourceId ? players.get(status.sourceId) : undefined;
    const event: MechanicEvent = {
      event: 'onStatusApplied',
      sourceId: status.sourceId,
      targetId: player.spawn.playerId,
      statusId: status.id,
    };
    for (const action of status.periodic.actions) {
      applyMechanicAction(action, event, source, player);
    }
  }
}

function regenerateResources(player: RuntimePlayer): void {
  for (const resource of player.resources.values()) {
    if (resource.regenPerTick === 0) {
      continue;
    }
    resource.value = clamp(resource.value + resource.regenPerTick, 0, resource.max);
  }
}

function activeMovementMultiplier(player: RuntimePlayer): number {
  let multiplier = 1;
  for (const status of player.statuses.values()) {
    if (status.untilTick > tick && status.movementMultiplier !== undefined) {
      multiplier = Math.min(multiplier, status.movementMultiplier);
    }
  }
  return multiplier;
}

function damageDealtMultiplier(player: RuntimePlayer | undefined): number {
  if (!player) {
    return 1;
  }
  let multiplier = 1;
  for (const status of player.statuses.values()) {
    if (status.untilTick > tick && status.damageDealtMultiplier !== undefined) {
      multiplier *= status.damageDealtMultiplier;
    }
  }
  return multiplier;
}

function damageTakenMultiplier(player: RuntimePlayer): number {
  let multiplier = 1;
  for (const status of player.statuses.values()) {
    if (status.untilTick > tick && status.damageTakenMultiplier !== undefined) {
      multiplier *= status.damageTakenMultiplier;
    }
  }
  return multiplier;
}

function updateMovementAndFacing(player: RuntimePlayer, speedMultiplier: number): void {
  if (!ruleset) {
    return;
  }
  const axisX = clamp(player.input.moveX, -1, 1);
  const axisY = clamp(player.input.moveY, -1, 1);
  if (ruleset.player.movement.mode === 'tank') {
    updateTankMovement(player, axisX, axisY, speedMultiplier);
    return;
  }
  updateTwinStickMovement(player, axisX, axisY, speedMultiplier);
}

function updateTwinStickMovement(player: RuntimePlayer, axisX: number, axisY: number, speedMultiplier: number): void {
  if (!ruleset) {
    return;
  }
  const move = normalized(axisX, axisY);
  const speed = ruleset.player.speed * speedMultiplier;
  player.body.setLinvel(move ? { x: move.x * speed, y: move.y * speed } : { x: 0, y: 0 }, true);
  const explicitAim = normalized(player.input.aimDx, player.input.aimDy);
  if (ruleset.player.aim.mode === 'free' && explicitAim) {
    player.facing = explicitAim;
    return;
  }
  if (move) {
    player.facing = move;
  }
}

function updateTankMovement(player: RuntimePlayer, turnInput: number, throttleInput: number, speedMultiplier: number): void {
  if (!ruleset) {
    return;
  }
  const turnRadians = (ruleset.player.movement.turnSpeedDegrees * Math.PI) / 180 / ruleset.tickRate;
  player.facing = rotate(player.facing, turnInput * turnRadians);
  const throttle = clamp(-throttleInput, -1, 1);
  const reverseMultiplier = throttle < 0 ? ruleset.player.movement.reverseMultiplier : 1;
  const speed = ruleset.player.speed * speedMultiplier * reverseMultiplier;
  player.body.setLinvel({ x: player.facing.x * throttle * speed, y: player.facing.y * throttle * speed }, true);
}

function readSnapshot(): EngineSnapshot {
  const activeRuleset = ruleset;
  if (!activeRuleset) {
    throw new Error('engine snapshot requested before init');
  }

  return {
    tick,
    nowMs: performance.now(),
    rulesetId: activeRuleset.id,
    projectiles: projectiles.map(toProjectileSnapshot),
    effects: effects.map(toEffectSnapshot),
    combatTexts: combatTexts.map(toCombatTextSnapshot),
    mechanicTraces,
    aiTraces,
    players: Array.from(players.values()).map((player) => {
      const pos = player.body.translation();
      const vel = player.body.linvel();
      const aim = aimForPlayer(player);
      const abilityIds = abilityIdsForPlayer(player);
      return {
        playerId: player.spawn.playerId,
        displayName: player.spawn.displayName,
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        hue: player.spawn.hue,
        hp: player.hp,
        maxHp: player.maxHp,
        alive: player.alive,
        respawnTick: player.respawnTick,
        slotCooldownTicks: abilityIds.map((abilityId) => Math.max(0, (player.cooldownUntil.get(abilityId) ?? 0) - tick)),
        lastUsedSlot: player.lastUsedSlot,
        aimDx: aim.x,
        aimDy: aim.y,
        facingDx: player.facing.x,
        facingDy: player.facing.y,
        role: player.spawn.role ?? 'player',
        team: player.team,
        status: toStatusSnapshot(player),
        statuses: toStatusSnapshots(player),
        resources: toResourceSnapshots(player),
        charging: player.charging ? toChargingSnapshot(player.charging) : undefined,
        lastInputSequence: player.input.sequence,
      };
    }),
  };
}

function toStatusSnapshot(player: RuntimePlayer): NonNullable<EngineSnapshot['players'][number]['status']> | undefined {
  const slow = strongestMovementSlow(player);
  if (!slow) {
    return undefined;
  }
  return {
    slowMultiplier: slow.movementMultiplier ?? 1,
    slowTicks: Math.max(0, slow.untilTick - tick),
    slowColor: slow.color,
  };
}

function toStatusSnapshots(player: RuntimePlayer): NonNullable<EngineSnapshot['players'][number]['statuses']> {
  return Array.from(player.statuses.values())
    .filter((status) => status.untilTick > tick)
    .map((status) => ({
      id: status.id,
      name: status.name,
      color: status.color,
      tags: status.tags,
      stacks: status.stacks,
      remainingTicks: Math.max(0, status.untilTick - tick),
      durationTicks: status.durationTicks,
      movementMultiplier: status.movementMultiplier,
      damageDealtMultiplier: status.damageDealtMultiplier,
      damageTakenMultiplier: status.damageTakenMultiplier,
    }));
}

function toResourceSnapshots(player: RuntimePlayer): NonNullable<EngineSnapshot['players'][number]['resources']> {
  return Array.from(player.resources.values()).map((resource) => ({
    id: resource.id,
    name: resource.name,
    color: resource.color,
    value: resource.value,
    max: resource.max,
  }));
}

function strongestMovementSlow(player: RuntimePlayer): RuntimeStatus | undefined {
  let slow: RuntimeStatus | undefined;
  for (const status of player.statuses.values()) {
    if (status.untilTick <= tick || status.movementMultiplier === undefined || status.movementMultiplier >= 1) {
      continue;
    }
    if (!slow || status.movementMultiplier < (slow.movementMultiplier ?? 1)) {
      slow = status;
    }
  }
  return slow;
}

function toChargingSnapshot(charge: RuntimeCharge): NonNullable<EngineSnapshot['players'][number]['charging']> {
  const maxTicks = charge.ability.charge?.maxTicks ?? 1;
  const ticks = chargeTicks(charge);
  return {
    slot: charge.slot,
    abilityId: charge.ability.id,
    chargeTicks: ticks,
    maxTicks,
    ratio: chargeRatio(ticks, maxTicks),
    aimDx: charge.aim.x,
    aimDy: charge.aim.y,
  };
}

function toProjectileSnapshot(projectile: RuntimeProjectile): ProjectileSnapshot {
  return {
    projectileId: projectile.projectileId,
    ownerId: projectile.ownerId,
    abilityId: projectile.ability.id,
    x: projectile.x,
    y: projectile.y,
    radius: projectile.ability.radius,
    color: projectile.ability.color,
  };
}

function toEffectSnapshot(effect: RuntimeEffect): EffectSnapshot {
  return {
    effectId: effect.effectId,
    kind: effect.kind,
    x: effect.x,
    y: effect.y,
    radius: effect.radius,
    color: effect.color,
    ageTicks: tick - effect.createdTick,
    lifetimeTicks: effect.lifetimeTicks,
  };
}

function toCombatTextSnapshot(text: RuntimeCombatText): CombatTextSnapshot {
  return {
    textId: text.textId,
    kind: text.kind,
    x: text.x,
    y: text.y,
    amount: text.amount,
    color: text.color,
    ageTicks: tick - text.createdTick,
    lifetimeTicks: text.lifetimeTicks,
  };
}

function stop(): void {
  if (tickHandle !== undefined) {
    clearInterval(tickHandle);
    tickHandle = undefined;
  }
  world?.free();
  world = undefined;
  players = new Map();
  projectiles = [];
  melees = [];
  effects = [];
  combatTexts = [];
  mechanicEvents = [];
  mechanicTraces = [];
  aiTraces = [];
  processingMechanics = false;
  paused = false;
}

function neutralInput(): PlayerInput {
  return {
    sequence: 0,
    moveX: 0,
    moveY: 0,
    aimDx: 0,
    aimDy: 0,
    castSlots: [],
    slotPresses: [],
    slotReleases: [],
    sampledAtMs: performance.now(),
  };
}

function updateChargeAim(player: RuntimePlayer): void {
  if (!player.charging) {
    return;
  }
  player.charging.aim = aimForAbility(player, player.charging.ability);
}

function chargeTicks(charge: RuntimeCharge): number {
  return Math.max(0, tick - charge.startedTick);
}

function aimForAbility(player: RuntimePlayer, ability: Ability): Vec2 {
  const baseAim = aimForPlayer(player);
  if (ability.targeting !== 'aim-assist') {
    return baseAim;
  }
  const target = findAimAssistTarget(player, ability, baseAim);
  if (!target) {
    return baseAim;
  }
  const origin = player.body.translation();
  const targetPos = target.body.translation();
  return normalized(targetPos.x - origin.x, targetPos.y - origin.y) ?? baseAim;
}

function findAimAssistTarget(owner: RuntimePlayer, ability: Ability, aim: Vec2): RuntimePlayer | undefined {
  const origin = owner.body.translation();
  const minDot = Math.cos((AIM_ASSIST_CONE_DEGREES * Math.PI) / 360);
  let best: { player: RuntimePlayer; distance: number } | undefined;
  for (const candidate of players.values()) {
    if (candidate.spawn.playerId === owner.spawn.playerId || !candidate.alive || sameTeam(owner, candidate)) {
      continue;
    }
    const pos = candidate.body.translation();
    const dx = pos.x - origin.x;
    const dy = pos.y - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001 || distance > ability.range + (ruleset?.player.radius ?? 0.5)) {
      continue;
    }
    const dot = (dx / distance) * aim.x + (dy / distance) * aim.y;
    if (dot < minDot) {
      continue;
    }
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && candidate.spawn.playerId < best.player.spawn.playerId)
    ) {
      best = { player: candidate, distance };
    }
  }
  return best?.player;
}

function aimForPlayer(player: RuntimePlayer): Vec2 {
  if (ruleset?.player.aim.mode === 'facing') {
    return player.facing;
  }
  const aim = normalized(player.input.aimDx, player.input.aimDy);
  if (aim) {
    return aim;
  }
  const move = ruleset?.player.movement.mode === 'tank' ? undefined : normalized(player.input.moveX, player.input.moveY);
  if (move) {
    return move;
  }
  return player.facing;
}

function sameTeam(a: RuntimePlayer | undefined, b: RuntimePlayer | undefined): boolean {
  return Boolean(a && b && a.team.length > 0 && a.team === b.team);
}

function stableSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 10_000;
}

function rotate(vector: Vec2, radians: number): Vec2 {
  if (Math.abs(radians) < 0.0001) {
    return vector;
  }
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalized(vector.x * cos - vector.y * sin, vector.x * sin + vector.y * cos) ?? vector;
}

function normalized(x: number, y: number): Vec2 | undefined {
  const mag = Math.hypot(x, y);
  if (mag < 0.001) {
    return undefined;
  }
  return { x: x / mag, y: y / mag };
}

function distancePointToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq > 0 ? clamp((apx * abx + apy * aby) / lengthSq, 0, 1) : 0;
  const x = a.x + abx * t;
  const y = a.y + aby * t;
  return Math.hypot(point.x - x, point.y - y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
