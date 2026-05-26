# Rules Implementation Reference

This document explains the current rule schema and how it is implemented.

## Rules schema sources

- `src/engine/protocol.ts` defines the types.
- `src/engine/rulesValidation.ts` enforces the allowed fields and ranges.
- `src/engine/defaultRules.ts` shows the shipped default preset.

## Top-level ruleset

The app validates these top-level rule fields:

- `id`: preset identifier, 1-96 chars, ID format.
- `name`: friendly preset name, 1-48 chars.
- `version`: integer `1..999`.
- `tickRate`: integer `10..120`.
- `maxPlayers`: integer `1..16`.
- `mapBundleId`: ID-format string, 1-96 chars.
- `contentHash`: string, 1-128 chars.

## Match

`match` is a required top-level rules section for objective-driven rooms.

- `teams`: a non-empty list of score teams.
- `durationTicks`: match duration in ticks, `300..36000`.
- `scoreLimit`: integer `1..1000`.
- `friendlyFire`: boolean, defaults to `true`.
- `respawnMode`: currently only `timed`.

### Teams

Each team in `match.teams[]` includes:

- `id`: ID-format string.
- `name`: friendly team name.
- `color`: `#rrggbb`.

### Objectives

`objectives` is a required top-level array that defines level objectives.
Each objective can be one of the following kinds:

- `relicPush`
- `deathmatch`
- `kingZone`

Common fields:

- `id`: objective identifier.
- `name`: objective name.
- `kind`: objective type.

`relicPush` fields:

- `spawn`: objective spawn point with `x` and `y`.
- `body`: physics body spec for the objective object.
- `scoreZones`: list of team scoring zones.
- `scoreCooldownTicks`: cooldown after a score.
- `resetOnScore`: whether the objective resets to spawn after scoring.

`deathmatch` fields:

- `pointsPerKill`: points awarded for each kill.
- `selfKillPenalty`: optional points deducted for self-kills.
- `friendlyFirePenalty`: optional points deducted for same-team kills.

`kingZone` fields:

- `zones`: control zone definitions.
- `pointsPerSecond`: points awarded per second to the controlling team.
- `contestRule`: how control is determined, one of `soloOnly`, `majority`, or `firstIn`.

### Score zones

Each `objective.scoreZones[]` entry includes:

- `id`: zone identifier.
- `team`: team ID that scores here.
- `x`, `y`: zone center.
- `radius`: zone radius.
- `points`: score amount.
- `color`: optional `#rrggbb`.

### Arena

- `arena.width`: `12..120`.
- `arena.height`: `8..80`.

### Player config

- `player.radius`: `0.2..2`.
- `player.speed`: `1..30`.
- `player.damping`: `0..30`.
- `player.maxHp`: `1..10000`.
- `player.respawnTicks`: `0..600`.
- `player.movement.mode`: `twinStick` or `tank`.
- `player.movement.turnSpeedDegrees`: `30..1440`.
- `player.movement.reverseMultiplier`: `0..1`.
- `player.aim.mode`: `free` or `facing`.

### Obstacles

`obstacles[]` are static boxes with:

- `id`: ID-format string.
- `x`, `y`: `-200..200`.
- `halfWidth`: `0.1..20`.
- `halfHeight`: `0.1..20`.

## Abilities

Abilities are either `projectile` or `melee`.

Common fields:

- `id`: ID-format string.
- `name`: 1-36 chars.
- `shape`: `projectile` or `melee`.
- `targeting`: `free-aim` or `aim-assist`.
- `tags`: optional unique tags.
- `damage`: `0..10000`.
- `cooldownTicks`: `1..3600`.
- `radius`: `0.05..10`.
- `range`: `0.1..100`.
- `color`: `#rrggbb`.
- `charge`: optional block.
- `effects`: optional array.

### Projectile-only fields

- `worldCollision`: `despawn` or `phase`.
- `speed`: `0.05..10`.
- `lifetimeTicks`: `1..1200`.

### Melee-only fields

- `arcDegrees`: `1..360`.
- `windupTicks`: `0..120`.
- `activeTicks`: `1..120`.

### Charge fields

If `charge` is present, it must include:

- `maxTicks`: `1..600`.
- `moveSpeedMultiplier`: `0..1` (default `0.55`).
- `damageMultiplierMin`: `0..20`.
- `damageMultiplierMax`: `0..20`, `>= min`.
- `rangeMultiplierMin` / `Max`: optional `0..20` pairs.
- `radiusMultiplierMin` / `Max`: optional `0..20` pairs.
- `autoRelease`: must be `true`.

### Effects

Supported effect kinds:

- `knockback`
  - `force`: `0.05..12`.
- `slow`
  - `multiplier`: `0.05..1`.
  - `durationTicks`: `1..1200`.
- `heal`
  - `target`: `self` or `hit`.
  - `amount`: `0..10000`.
- `selfDash`
  - `distance`: `0.05..12`.
- `applyStatus`
  - `target`: `self` or `hit`.
  - `statusId`: references `mechanics.statuses`.
  - optional `durationTicks`, `stacks`.
- `spawnBody`
  - `target`: `self`, `hit`, or `impact`.
  - optional `inheritVelocity`: `0..4`.
  - `body`: physics body.
- `snare`
  - `target`: `hit`.
  - `anchor`: `impact` or `body`.
  - `durationTicks`: `1..3600`.
  - `radius`: `0.2..30`.
  - `stiffness`: `1..2000`.
  - `damping`: `0..200`.
  - optional `color`.
  - `body` required if `anchor` is `body`.
- `dragBody`
  - `target`: `self` or `hit`.
  - `durationTicks`: `1..3600`.
  - `leashLength`: `0.2..30`.
  - `stiffness`: `1..2000`.
  - `damping`: `0..200`.
  - optional `color`.
  - `body` required.

#### Physics body spec

- `shape`: must be `ball`.
- `radius`: `0.05..5`.
- `mass`: `0.05..200`.
- `friction`: `0..5`, default `0.55`.
- `restitution`: `0..2`, default `0.18`.
- `linearDamping`: `0..40`, default `1.4`.
- `lifetimeTicks`: `1..3600`.
- `color`: `#rrggbb`.

## Mechanics

`mechanics` is optional.

### Statuses

Each `mechanics.statuses[]` entry supports:

- `id`, `name`, `color`, `durationTicks`.
- optional `tags`, `stacking`, `maxStacks`.
- optional `movementMultiplier`, `damageDealtMultiplier`, `damageTakenMultiplier`.
- optional `periodic` actions.

### Resources

Each `mechanics.resources[]` entry supports:

- `id`, `name`, `color`.
- `max`, `start`, `regenPerTick`.

Resources are live runtime values.
They are initialized from `start`, clamped to `max`, and updated every tick by `regenPerTick`.

The default preset defines:

- `shield`: starts at `18`, max `36`, `regenPerTick` `0.08`.
- `heat`: starts at `0`, max `100`, `regenPerTick` `-0.18`.

### Triggers

Each `mechanics.triggers[]` entry supports:

- `id`, optional `name`.
- `event`: `onCast`, `onHit`, `onDamageTaken`, `onStatusApplied`, `onStatusExpired`, `onKill`, `onLowHp`, `onObjectiveEnter`, `onObjectiveTick`, or `onScore`.
- optional `conditions`.
- required `actions`.

Supported conditions:

- `hasStatus` / `missingStatus`
- `hpBelow`
- `resourceAtLeast`
- `slotUsed`
- `abilityTag`
- `objectiveId`
- `scoringTeam`

Supported actions:

- `applyStatus`
- `removeStatus`
- `dealDamage`
- `heal`
- `knockback`
- `slow`
- `modifyResource`
- `flashEffect`

## NPCs

`npcs` is optional.

### Archetypes

Each `npcs.archetypes[]` entry supports:

- `id`, `name`, `hue`, `team`.
- optional `hpMultiplier`, `speedMultiplier`.
- `loadout.abilityIds`: up to 4 ability IDs.
- `behavior.mode`: `idle`, `wander`, `seek`, `kite`.
- optional `behavior.aggroRange`, `preferredRange`, `wanderRadius`.
- `casting.slots`: optional unique slot indexes `0..3`.
- optional `casting.minRange`, `casting.maxRange`.

### Spawns

- `npcs.labSpawns[]` are used in `Lab`.
- `npcs.sessionSpawns[]` are used in `Solo` and `Host`.
- Each spawn supports `id`, `archetypeId`, `x`, `y`, optional `team`.

## Runtime semantics

### Healing

- `heal` ability effects and trigger actions are applied in `src/engine/worker.ts`.
- `healPlayer()` clamps HP to `maxHp` and only applies when the target is alive.

### Teams

- Team strings are compared by equality.
- Friendly-fire is blocked by `sameTeam(owner, target)`.
- NPC targeting skips same-team actors.
- Solo and host-local players are explicitly spawned on team `players`.
- Other player actors default to their own `playerId` unless `spawn.team` overrides it.

## Default preset behavior

The shipped default ruleset now uses:

- `id: beat-arena-v10`
- `name: Beat Arena Relic Push V10`
- a `match` definition with two teams, a score limit, friendly fire, and timed respawn mode.
- a relic push objective with a physical relic body and team score zones.
- 4 player slots: `pulse-bolt`, `arc-slash`, `seeker-spark`, `ion-lance`.
- 6 defined abilities including physics and charge abilities.
- 3 statuses: `shocked`, `chilled`, `overheated`.
- 2 resources: `shield`, `heat`.
- triggers that make `shield` and `heat` meaningful, plus a score-related objective trigger.

## Notes

- The rule set is fully validated before game start.
- If validation fails, the app rejects the rules and does not start a mode.
