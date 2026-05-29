# Engine Flow

This document describes the current engine tick loop, physics handling, collision logic, and status/resource update flow.

## Worker entry points

The authoritative simulation runs in `src/engine/worker.ts`.
The main thread communicates with the worker through `EngineClient`.

### Initialization

- `addPlayer()` constructs Rapier bodies for players and NPCs.
- `initialResources()` builds runtime resource maps from `ruleset.mechanics.resources`.
- `active` players are stored in `players: Map<string, RuntimePlayer>`.
- `projectiles`, `melees`, `physicsBodies`, `constraints`, `effects`, and `combatTexts` track active runtime entities.

## Tick loop overview

Main-thread commands can mutate worker state between timer ticks. The timed tick loop itself performs the following major steps:

1. if paused, emit the current snapshot and return early.
2. iterate players: handle respawn/death state, clear expired statuses, run status periodic actions, regenerate resources, and refresh NPC input.
3. consume input events, update movement/facing, and process charge press/release or auto-release behavior.
4. advance Rapier physics with `world.step()`.
5. enforce active constraint corrections after the physics step.
6. step objectives and objective scoring logic.
7. step projectiles and melees, which is where damage, healing, effect application, and trigger emission happen.
8. prune expired constraints, physics bodies, transient effects, and combat text.
9. increment `tick` and emit the snapshot for the main thread.

## Projectiles

Projectiles are runtime objects with:

- `projectileId`
- `ownerId`
- ability definition
- current position and direction
- age and travel distance

Projectile stepping uses the ability's `speed`, `lifetimeTicks`, and `worldCollision`.

### Hit detection

- `findProjectileHit()` ignores the projectile owner, dead actors, and same-team actors.
- It uses distance-to-segment against the player radius and projectile radius.
- On hit, the projectile resolves damage, impact effects, and triggers.

## Melee attacks

Melee attacks are runtime entries with:

- owner ID
- ability definition
- facing vector
- start tick
- hit player set

The worker checks melee hits only during the active window.
It filters out the owner, dead players, already-hit players, and same-team actors.

## Physics bodies and constraints

The engine supports physics effects via Rapier bodies and impulse joints.

### Physics bodies

- Created by `spawnBody`, `snare`, and `dragBody` effects.
- Runtime bodies are stored in `physicsBodies`.
- They have lifetimes and can be cleaned up automatically.

### Constraints

- `snare` and `dragBody` create spring impulse joints.
- Constraints are stored in `constraints` and expire after `lifetimeTicks`.
- `enforceActiveConstraints()` applies additional correction to keep targets within leash/snare distance.

### Movement modifiers

- `activePhysicsConstraintMovementMultiplier()` returns a movement multiplier based on current constraints.
- `drag` constraints multiply movement by `0.68`.
- `snare` constraints cap movement multiplier at `0.86`.

## Status updates

Statuses are runtime objects with:

- id, name, color, tags
- duration, stacks, max stacks
- movement, damage dealt, and damage taken modifiers
- optional periodic actions

### Application and expiry

- `applyRuntimeStatus()` enforces stacking rules from `stacking`, `maxStacks`, and duration.
- statuses are only applied to alive players.
- `processStatusPeriodicEffects()` fires periodic actions on interval.
- expired statuses are filtered out at tick time.

### Derived multipliers

- `activeMovementMultiplier()` finds the strongest slow effect on a player.
- `damageDealtMultiplier()` multiplies outgoing damage from status effects.
- `damageTakenMultiplier()` multiplies incoming damage from status effects.

## Resource updates

Resources are live runtime values.

## Objectives and match state

Objective-driven rooms use `ruleset.match` and `ruleset.objectives`.
The worker creates objective bodies from objective definitions, tracks active objective zones, and emits objective events during the tick loop.

- `resetObjectives()` rebuilds objective state and can reset scores when requested.
- `stepObjectives()` runs objective-specific logic each tick.
- `relicPush` emits `onObjectiveEnter` when the relic enters a score zone, `onObjectiveTick` while it remains in a live scoring zone, and `onScore` when the score is applied.
- `deathmatch` and `kingZone` emit `onScore` when their scoring logic awards or subtracts points.
- `relicPush` scoring honors `objective.scoreCooldownTicks` and `resetOnScore`.

This feature is currently implemented for `relicPush`, `deathmatch`, and `kingZone` objectives.

- `initialResources()` creates a resource map from `ruleset.mechanics.resources`.
- `regenerateResources()` applies `regenPerTick` each tick.
- `modifyResource()` safely increments or decrements resource values, clamps to `[0,max]`, and emits UI feedback.

### Default resource behavior

- `shield` is a recoverable resource with positive regen.
- `heat` is a charging resource with negative regen (decay).

## Damage and healing

### Damage

- `damagePlayer()` prevents damage if the target is dead or if the source is same-team.
- It applies status-based damage multipliers.
- If HP drops to zero, the player dies, clears statuses, and triggers respawn state.

### Healing

- `healPlayer()` only works on alive players and clamps at `maxHp`.
- `applySelfEffects()` handles `heal` effects with `target: 'self'`.
- `applyHitEffect()` handles `heal` effects with `target: 'hit'`.

## Movement

Player movement is updated per tick from input:

- `updateMovementAndFacing()` chooses twin-stick or tank steering.
- `updateTwinStickMovement()` converts move axes into velocity and facing.
- `updateOrthogonalMovement()` keeps only the dominant move axis before applying velocity.
- `updateTankMovement()` rotates facing and applies throttle-based velocity.
- Facing and aim are separated when `player.aim.mode` is `free`.

## Snapshot output

The worker publishes `EngineSnapshot` objects containing:

- tick and timestamp
- players with position, HP, status, resources, and charging info
- projectiles, physics bodies, constraints
- effects, combat texts, mechanic traces, and AI traces
- match state and objective snapshots

Snapshots are serialized by `toProjectileSnapshot()`, `toPhysicsBodySnapshot()`, `toResourceSnapshots()`, `toObjectiveSnapshot()`, and related helpers.
