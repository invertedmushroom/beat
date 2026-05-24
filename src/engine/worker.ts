import RAPIER from '@dimforge/rapier2d-compat';
import { chargeRatio, scaleAbilityForCharge } from './charge';
import { spawnPointForIndex } from './defaultRules';
import type {
  Ability,
  AbilityEffect,
  CombatTextSnapshot,
  EffectSnapshot,
  EngineCommand,
  EngineEvent,
  EngineSnapshot,
  MeleeAbility,
  PlayerInput,
  PlayerSpawn,
  ProjectileAbility,
  ProjectileSnapshot,
  Ruleset,
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
  alive: boolean;
  respawnTick: number;
  cooldownUntil: Map<string, number>;
  facing: Vec2;
  lastUsedSlot: number;
  lastHandledInputSequence: number;
  charging?: RuntimeCharge;
  slow?: RuntimeSlow;
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

type RuntimeSlow = {
  multiplier: number;
  untilTick: number;
  color: string;
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
let players = new Map<string, RuntimePlayer>();
let projectiles: RuntimeProjectile[] = [];
let melees: RuntimeMelee[] = [];
let effects: RuntimeEffect[] = [];
let combatTexts: RuntimeCombatText[] = [];

const AIM_ASSIST_CONE_DEGREES = 70;

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
  players = new Map();
  projectiles = [];
  melees = [];
  effects = [];
  combatTexts = [];

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

  const point = spawnPointForIndex(spawnIndex++);
  const spawnSlot = spawnIndex - 1;
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
    hp: ruleset.player.maxHp,
    alive: true,
    respawnTick: 0,
    cooldownUntil: new Map(),
    facing: { x: 1, y: 0 },
    lastUsedSlot: 0,
    lastHandledInputSequence: 0,
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

  for (const player of players.values()) {
    if (!player.alive && player.respawnTick <= tick) {
      respawnPlayer(player);
    }
    if (!player.alive) {
      player.charging = undefined;
      player.slow = undefined;
      player.body.setLinvel({ x: 0, y: 0 }, true);
      player.lastHandledInputSequence = player.input.sequence;
      continue;
    }
    clearExpiredStatuses(player);

    const hasNewInputEvents = player.input.sequence !== player.lastHandledInputSequence;
    const slotPresses = hasNewInputEvents ? player.input.slotPresses : [];
    const castSlots = hasNewInputEvents ? player.input.castSlots : [];
    const slotReleases = hasNewInputEvents ? player.input.slotReleases : [];

    for (const slot of slotPresses) {
      handleSlotPress(player, slot);
    }
    const speedMultiplier = (player.charging?.ability.charge?.moveSpeedMultiplier ?? 1) * activeSlowMultiplier(player);
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
  const ability = abilityForSlot(slot);
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
  const ability = abilityForSlot(slot);
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
  if (ability.shape === 'projectile') {
    spawnProjectile(player, ability, aim);
  } else {
    spawnMelee(player, ability, aim);
  }
}

function abilityForSlot(slot: number): Ability | undefined {
  const activeRuleset = ruleset;
  if (!activeRuleset || !Number.isInteger(slot) || slot < 0 || slot >= activeRuleset.loadout.abilityIds.length) {
    return undefined;
  }
  const abilityId = activeRuleset.loadout.abilityIds[slot];
  return activeRuleset.abilities.find((candidate) => candidate.id === abilityId);
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
      damagePlayer(hitPlayer, projectile.ability.damage);
      addImpact(to.x, to.y, projectile.ability.radius * 3.4, projectile.ability.color);
      if (hitPlayer.alive) {
        applyHitEffects(projectile.ability, hitPlayer, { x: projectile.dx, y: projectile.dy });
      }
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
        if (target.spawn.playerId === melee.ownerId || !target.alive || melee.hitPlayers.has(target.spawn.playerId)) {
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
          damagePlayer(target, melee.ability.damage);
          addImpact(targetPos.x, targetPos.y, melee.ability.radius, melee.ability.color);
          if (target.alive) {
            applyHitEffects(melee.ability, target, normalized(dx, dy) ?? { x: melee.dx, y: melee.dy });
          }
        }
      }
    }
    if (age < melee.ability.windupTicks + melee.ability.activeTicks) {
      next.push(melee);
    }
  }
  melees = next;
}

function damagePlayer(player: RuntimePlayer, damage: number): void {
  if (!ruleset || !player.alive) {
    return;
  }
  const pos = player.body.translation();
  player.hp = Math.max(0, player.hp - damage);
  addCombatText(pos.x, pos.y - ruleset.player.radius * 1.8, 'damage', damage, '#ffd166');
  if (player.hp > 0) {
    return;
  }
  player.charging = undefined;
  player.slow = undefined;
  player.alive = false;
  player.respawnTick = tick + ruleset.player.respawnTicks;
  player.body.setLinvel({ x: 0, y: 0 }, true);
  player.body.setEnabled(false);
  addEffect('death', pos.x, pos.y, ruleset.player.radius * 5, '#ffffff', 28);
}

function respawnPlayer(player: RuntimePlayer): void {
  if (!ruleset) {
    return;
  }
  const point = spawnPointForIndex(player.spawnSlot);
  player.hp = ruleset.player.maxHp;
  player.alive = true;
  player.respawnTick = 0;
  player.slow = undefined;
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
  }
}

function applyHitEffects(ability: Ability, target: RuntimePlayer, direction: Vec2): void {
  for (const effect of ability.effects ?? []) {
    applyHitEffect(effect, target, direction, ability.color);
  }
}

function applyHitEffect(effect: AbilityEffect, target: RuntimePlayer, direction: Vec2, color: string): void {
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
  const current = currentSlow(player);
  const untilTick = tick + durationTicks;
  player.slow = {
    multiplier: Math.min(current?.multiplier ?? 1, multiplier),
    untilTick: current && current.multiplier < multiplier ? Math.max(current.untilTick, untilTick) : untilTick,
    color: current && current.multiplier < multiplier ? current.color : color,
  };
  const pos = player.body.translation();
  addEffect('slow', pos.x, pos.y, ruleset.player.radius * 2.5, color, Math.min(34, Math.max(14, durationTicks)));
}

function healPlayer(player: RuntimePlayer, amount: number): void {
  if (!player.alive || !ruleset || amount <= 0) {
    return;
  }
  const before = player.hp;
  player.hp = Math.min(ruleset.player.maxHp, player.hp + amount);
  const healed = player.hp - before;
  if (healed <= 0) {
    return;
  }
  const pos = player.body.translation();
  addCombatText(pos.x, pos.y - ruleset.player.radius * 1.8, 'heal', healed, '#2fd17c');
  addEffect('heal', pos.x, pos.y, ruleset.player.radius * 2.7, '#2fd17c', 18);
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
  for (const player of players.values()) {
    if (player.spawn.playerId === projectile.ownerId || !player.alive) {
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
  if (player.slow && player.slow.untilTick <= tick) {
    player.slow = undefined;
  }
}

function currentSlow(player: RuntimePlayer): RuntimeSlow | undefined {
  return player.slow && player.slow.untilTick > tick ? player.slow : undefined;
}

function activeSlowMultiplier(player: RuntimePlayer): number {
  return currentSlow(player)?.multiplier ?? 1;
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
    players: Array.from(players.values()).map((player) => {
      const pos = player.body.translation();
      const vel = player.body.linvel();
      const aim = aimForPlayer(player);
      return {
        playerId: player.spawn.playerId,
        displayName: player.spawn.displayName,
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        hue: player.spawn.hue,
        hp: player.hp,
        maxHp: activeRuleset.player.maxHp,
        alive: player.alive,
        respawnTick: player.respawnTick,
        slotCooldownTicks: activeRuleset.loadout.abilityIds.map((abilityId) => Math.max(0, (player.cooldownUntil.get(abilityId) ?? 0) - tick)),
        lastUsedSlot: player.lastUsedSlot,
        aimDx: aim.x,
        aimDy: aim.y,
        facingDx: player.facing.x,
        facingDy: player.facing.y,
        status: toStatusSnapshot(player),
        charging: player.charging ? toChargingSnapshot(player.charging) : undefined,
        lastInputSequence: player.input.sequence,
      };
    }),
  };
}

function toStatusSnapshot(player: RuntimePlayer): NonNullable<EngineSnapshot['players'][number]['status']> | undefined {
  const slow = currentSlow(player);
  if (!slow) {
    return undefined;
  }
  return {
    slowMultiplier: slow.multiplier,
    slowTicks: Math.max(0, slow.untilTick - tick),
    slowColor: slow.color,
  };
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
    if (candidate.spawn.playerId === owner.spawn.playerId || !candidate.alive) {
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
