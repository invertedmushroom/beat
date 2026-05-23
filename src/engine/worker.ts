import RAPIER from '@dimforge/rapier2d-compat';
import { spawnPointForIndex } from './defaultRules';
import type {
  Ability,
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
  lastPrimaryPressed: boolean;
  facing: Vec2;
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
let players = new Map<string, RuntimePlayer>();
let projectiles: RuntimeProjectile[] = [];
let melees: RuntimeMelee[] = [];
let effects: RuntimeEffect[] = [];

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
  players = new Map();
  projectiles = [];
  melees = [];
  effects = [];

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
    lastPrimaryPressed: false,
    facing: { x: 1, y: 0 },
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
      player.body.setLinvel({ x: 0, y: 0 }, true);
      player.lastPrimaryPressed = player.input.primaryPressed;
      continue;
    }

    const axisX = clamp(player.input.moveX, -1, 1);
    const axisY = clamp(player.input.moveY, -1, 1);
    const mag = Math.hypot(axisX, axisY) || 1;
    const speed = ruleset.player.speed;
    player.body.setLinvel({ x: (axisX / mag) * speed, y: (axisY / mag) * speed }, true);
    player.facing = aimForPlayer(player);
    if (player.input.primaryPressed && !player.lastPrimaryPressed) {
      castPrimary(player);
    }
    player.lastPrimaryPressed = player.input.primaryPressed;
  }

  world.step();
  stepProjectiles();
  stepMelees();
  pruneEffects();
  tick += 1;
  port.postMessage({ type: 'snapshot', snapshot: readSnapshot() });
}

function castPrimary(player: RuntimePlayer): void {
  const activeRuleset = ruleset;
  if (!activeRuleset) {
    return;
  }
  const ability = activeRuleset.abilities.find((candidate) => candidate.id === activeRuleset.loadout.primaryAbilityId);
  if (!ability || (player.cooldownUntil.get(ability.id) ?? 0) > tick) {
    return;
  }
  player.cooldownUntil.set(ability.id, tick + ability.cooldownTicks);
  if (ability.shape === 'projectile') {
    spawnProjectile(player, ability);
  } else {
    spawnMelee(player, ability);
  }
}

function spawnProjectile(player: RuntimePlayer, ability: ProjectileAbility): void {
  const pos = player.body.translation();
  const aim = aimForPlayer(player);
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

function spawnMelee(player: RuntimePlayer, ability: MeleeAbility): void {
  const pos = player.body.translation();
  const aim = aimForPlayer(player);
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
  player.hp = Math.max(0, player.hp - damage);
  if (player.hp > 0) {
    return;
  }
  player.alive = false;
  player.respawnTick = tick + ruleset.player.respawnTicks;
  player.body.setLinvel({ x: 0, y: 0 }, true);
  player.body.setEnabled(false);
  const pos = player.body.translation();
  addImpact(pos.x, pos.y, ruleset.player.radius * 4, '#ffffff');
}

function respawnPlayer(player: RuntimePlayer): void {
  if (!ruleset) {
    return;
  }
  const point = spawnPointForIndex(player.spawnSlot);
  player.hp = ruleset.player.maxHp;
  player.alive = true;
  player.respawnTick = 0;
  player.cooldownUntil.clear();
  player.body.setEnabled(true);
  player.body.setTranslation(point, true);
  player.body.setLinvel({ x: 0, y: 0 }, true);
  effects.push({
    effectId: `spawn-${++effectIndex}`,
    kind: 'spawn',
    x: point.x,
    y: point.y,
    radius: ruleset.player.radius * 3,
    color: '#2fd17c',
    createdTick: tick,
    lifetimeTicks: 20,
  });
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
  effects.push({
    effectId: `impact-${++effectIndex}`,
    kind: 'impact',
    x,
    y,
    radius,
    color,
    createdTick: tick,
    lifetimeTicks: 14,
  });
}

function pruneEffects(): void {
  effects = effects.filter((effect) => tick - effect.createdTick < effect.lifetimeTicks);
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
    players: Array.from(players.values()).map((player) => {
      const pos = player.body.translation();
      const vel = player.body.linvel();
      const primary = primaryAbility();
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
        primaryCooldownTicks: primary ? Math.max(0, (player.cooldownUntil.get(primary.id) ?? 0) - tick) : 0,
        lastInputSequence: player.input.sequence,
      };
    }),
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
}

function neutralInput(): PlayerInput {
  return {
    sequence: 0,
    moveX: 0,
    moveY: 0,
    aimDx: 0,
    aimDy: 0,
    primaryPressed: false,
    sampledAtMs: performance.now(),
  };
}

function primaryAbility(): Ability | undefined {
  return ruleset?.abilities.find((ability) => ability.id === ruleset?.loadout.primaryAbilityId);
}

function aimForPlayer(player: RuntimePlayer): Vec2 {
  const aim = normalized(player.input.aimDx, player.input.aimDy);
  if (aim) {
    return aim;
  }
  const move = normalized(player.input.moveX, player.input.moveY);
  if (move) {
    return move;
  }
  return player.facing;
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
