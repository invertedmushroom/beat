# Room Configuration Guide

The Menu

| Setting | Where | What it affects | Notes |
| --- | --- | --- | --- |
| `Name` | Lobby input | Your local display name | UI max length is 24 characters. Used for your local player and sent in join requests. |
| `Room` | Lobby input | Hosted room title in the room list | UI max length is 36 characters. If blank, hosting falls back to `"<Name>'s room"`. |
| `Host` | Lobby button | Starts a multiplayer room with the current Rules JSON | The room is advertised through the configured directory and runs over WebRTC. |
| `Solo` | Lobby button | Starts a local single-player session with the current Rules JSON | Does not advertise a room. Uses `sessionSpawns`, not `labSpawns`. |
| `Lab` | Lobby button | Starts the local authoring/test harness with the current Rules JSON | Uses `labSpawns`, exposes trace/debug controls, and lets you spawn configured NPC archetypes. |
| Room row click | Rooms list | Joins the selected hosted room | On join, the client receives the host's ruleset. Your local JSON does not override the host. |
| `Apply` | Rules editor | Re-parse and validate the Rules JSON | Invalid JSON or invalid rule values block start. |
| `Copy` | Rules editor | Normalizes and copies the current Rules JSON | Good for exporting a clean, validated version. |
| `Reset` | Rules editor | Resets to the current default preset | The default preset is created by `createDefaultRuleset()`. |
| `Combo Preset` | Rules examples | Resets to the shipped default preset | This is effectively the baseline preset. |
| `Bleed DOT` | Rules examples | Adds a bleeding status and makes `arc-slash` apply it | Useful for trigger/status testing. |
| `Execute` | Rules examples | Adds a low-HP execute trigger | Useful for conditional trigger testing. |
| `Physics` | Rules examples | Keeps the default ruleset but swaps the player loadout to the physics abilities | Sets the loadout to `anchor-orb`, `wrecking-weight`, `seeker-spark`, `ion-lance`. |

## What A Hosted Room Advertises

When you press `Host`, the app builds a `RoomInfo` record. Only some of its fields are directly editable.

| Field | Source | Editable? | Notes |
| --- | --- | --- | --- |
| `roomId` | Generated at host start | No | Runtime ID. |
| `hostPeerId` | Generated for the local peer | No | Runtime peer ID. |
| `name` | Lobby `Room` input | Yes | Falls back to `"<Name>'s room"` if the field is blank. |
| `rulesetId` | `rules.id` | Yes | Good for human-readable preset naming/versioning. |
| `rulesetHash` | Calculated from the validated ruleset | No | Auto-derived. Shown in the UI in short form. |
| `contentHash` | `rules.contentHash` | Yes | Host advertises it exactly as written in the rules. |
| `mapBundleId` | `rules.mapBundleId` | Yes | Host advertises it exactly as written in the rules. |
| `playerCount` | Runtime | No | Starts at `1` for the host and changes as peers join/leave. |
| `maxPlayers` | `rules.maxPlayers` | Yes | Room capacity comes directly from the ruleset. |
| `transport` | Fixed by code | No | Always `webrtc`. |
| `status` | Runtime | Not directly | Uses `open`, `full`, or `closed`. |
| `createdAt` | Runtime | No | Host timestamp. |
| `lastHeartbeat` | Runtime | No | Used by the directory to prune stale rooms. |

## Shared JSON Rules

These rules apply across many fields in the Rules JSON:

| Rule | Meaning |
| --- | --- |
| ID-like fields | Most IDs use `a-z`, `A-Z`, `0-9`, `_`, `-`, and `:` only. This applies to fields like `id`, `mapBundleId`, `abilityId`, `statusId`, and `team`. |
| Colors | Colors must be `#rrggbb`. |
| Trimmed strings | User-facing names and hashes are trimmed before validation. Blank strings are rejected. |
| Unique IDs | Status IDs, resource IDs, trigger IDs, NPC archetype IDs, and NPC spawn IDs must be unique within their own arrays. |
| References must exist | Loadouts, status references, resource references, and NPC spawn references must point at real entries. |
| Rules are locked after start | You can only edit rules before pressing `Host`, `Solo`, or `Lab`. |

## Top-Level Ruleset Fields

These are the fields at the top of the Rules JSON.

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Preset identifier | 1-96 chars, ID format |
| `name` | Friendly preset name | 1-48 chars |
| `version` | Manual version marker | Integer `1..999` |
| `tickRate` | Simulation rate | Integer `10..120` |
| `maxPlayers` | Room capacity | Integer `1..16` |
| `mapBundleId` | Map/content identifier | 1-96 chars, ID format |
| `contentHash` | Content fingerprint string | 1-128 chars |

### `arena`

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `arena.width` | Arena width | Number `12..120` |
| `arena.height` | Arena height | Number `8..80` |

### `player`

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `player.radius` | Player collider radius | Number `0.2..2` |
| `player.speed` | Base move speed | Number `1..30` |
| `player.damping` | Movement damping | Number `0..30` |
| `player.maxHp` | Maximum HP | Integer `1..10000` |
| `player.respawnTicks` | Respawn delay | Integer `0..600` |
| `player.movement.mode` | Movement style | `twinStick` or `tank` |
| `player.movement.turnSpeedDegrees` | Tank steering turn rate | Number `30..1440` |
| `player.movement.reverseMultiplier` | Tank reverse speed multiplier | Number `0..1` |
| `player.aim.mode` | Aim style | `free` or `facing` |

Practical note:

- `twinStick` + `free` is the most direct action-game setup.
- `tank` + `facing` is the most different control scheme and worth testing explicitly.

### `obstacles[]`

Each obstacle is an axis-aligned rectangle.

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Obstacle identifier | 1-96 chars, ID format |
| `x` | Center X | Number `-200..200` |
| `y` | Center Y | Number `-200..200` |
| `halfWidth` | Half width | Number `0.1..20` |
| `halfHeight` | Half height | Number `0.1..20` |

## Player Loadout

`loadout.abilityIds` defines the four player hotbar slots.

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `loadout.abilityIds` | Player hotbar | Exactly 4 ability IDs, each referencing an entry in `abilities[]` |

Practical note:

- Slot indexes are `0..3` internally.
- In play, those map to the four visible skill slots and the `1`-`4` keys.
- The current controls also use `Space` and left click as slot 1 casts.

## Abilities

Each entry in `abilities[]` defines either a projectile or melee skill.

### Common Ability Fields

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Ability identifier | 1-96 chars, ID format |
| `name` | Ability name | 1-36 chars |
| `shape` | Ability family | `projectile` or `melee` |
| `targeting` | Aim behavior | `free-aim` or `aim-assist` |
| `tags` | Optional trigger tags | Unique tag strings, each 1-32 chars, tag format |
| `damage` | Base damage | Number `0..10000` |
| `cooldownTicks` | Cooldown length | Integer `1..3600` |
| `radius` | Hit radius / effect radius | Number `0.05..10` |
| `range` | Effective range | Number `0.1..100` |
| `color` | UI/render color | `#rrggbb` |
| `charge` | Optional charge block | See below |
| `effects` | Optional effect list | See below |

### Projectile-Only Fields

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `worldCollision` | What happens on wall hit | `despawn` or `phase` |
| `speed` | Projectile travel speed | Number `0.05..10` |
| `lifetimeTicks` | Projectile lifetime | Integer `1..1200` |

### Melee-Only Fields

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `arcDegrees` | Melee arc | Number `1..360` |
| `windupTicks` | Startup delay | Integer `0..120` |
| `activeTicks` | Active hit window | Integer `1..120` |

### `charge`

Charge is optional. If present, it must look like this:

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `maxTicks` | Full charge duration | Integer `1..600` |
| `moveSpeedMultiplier` | Move slowdown while charging | Number `0..1`, defaults to `0.55` |
| `damageMultiplierMin` | Minimum damage scale | Number `0..20` |
| `damageMultiplierMax` | Maximum damage scale | Number `0..20`, must be `>= min` |
| `rangeMultiplierMin` | Optional minimum range scale | Number `0..20` |
| `rangeMultiplierMax` | Optional maximum range scale | Number `0..20`, must be paired with `Min` and `>= min` |
| `radiusMultiplierMin` | Optional minimum radius scale | Number `0..20` |
| `radiusMultiplierMax` | Optional maximum radius scale | Number `0..20`, must be paired with `Min` and `>= min` |
| `autoRelease` | Full-charge fire behavior | Must be `true` |

### `effects[]`

Effects are optional, but once present each entry must use one of the supported kinds below.

#### `knockback`

| Field | Accepted values |
| --- | --- |
| `kind` | `knockback` |
| `force` | Number `0.05..12` |

#### `slow`

| Field | Accepted values |
| --- | --- |
| `kind` | `slow` |
| `multiplier` | Number `0.05..1` |
| `durationTicks` | Integer `1..1200` |

#### `heal`

| Field | Accepted values |
| --- | --- |
| `kind` | `heal` |
| `target` | `self` or `hit` |
| `amount` | Number `0..10000` |

#### `selfDash`

| Field | Accepted values |
| --- | --- |
| `kind` | `selfDash` |
| `distance` | Number `0.05..12` |

#### `applyStatus`

| Field | Accepted values |
| --- | --- |
| `kind` | `applyStatus` |
| `target` | `self` or `hit` |
| `statusId` | Must reference `mechanics.statuses[]` |
| `durationTicks` | Optional integer `1..3600` |
| `stacks` | Optional integer `1..50` |

#### `spawnBody`

| Field | Accepted values |
| --- | --- |
| `kind` | `spawnBody` |
| `target` | `self`, `hit`, or `impact` |
| `inheritVelocity` | Optional number `0..4` |
| `body` | Physics body spec |

#### `snare`

| Field | Accepted values |
| --- | --- |
| `kind` | `snare` |
| `target` | Must be `hit` |
| `anchor` | `impact` or `body` |
| `durationTicks` | Integer `1..3600` |
| `radius` | Number `0.2..30` |
| `stiffness` | Number `1..2000` |
| `damping` | Number `0..200` |
| `color` | Optional `#rrggbb` |
| `body` | Required when `anchor` is `body`; uses the physics body spec |

#### `dragBody`

| Field | Accepted values |
| --- | --- |
| `kind` | `dragBody` |
| `target` | `self` or `hit` |
| `durationTicks` | Integer `1..3600` |
| `leashLength` | Number `0.2..30` |
| `stiffness` | Number `1..2000` |
| `damping` | Number `0..200` |
| `color` | Optional `#rrggbb` |
| `body` | Physics body spec |

#### Physics body spec

This spec is shared by `spawnBody`, `snare.anchor = body`, and `dragBody`.

| Field | Accepted values |
| --- | --- |
| `shape` | Must be `ball` |
| `radius` | Number `0.05..5` |
| `mass` | Number `0.05..200` |
| `friction` | Optional number `0..5`, defaults to `0.55` |
| `restitution` | Optional number `0..2`, defaults to `0.18` |
| `linearDamping` | Optional number `0..40`, defaults to `1.4` |
| `lifetimeTicks` | Integer `1..3600` |
| `color` | `#rrggbb` |

## Mechanics

`mechanics` is optional. If you omit it entirely, it becomes empty arrays for statuses, resources, and triggers.

## `mechanics.statuses[]`

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Status identifier | 1-96 chars, ID format |
| `name` | Status name | 1-36 chars |
| `color` | UI/render color | `#rrggbb` |
| `durationTicks` | Default status duration | Integer `1..3600` |
| `tags` | Optional status tags | Unique tag strings |
| `stacking` | Stack behavior | `refresh` or `stack` |
| `maxStacks` | Max stacks when stacking | Integer `1..50` |
| `movementMultiplier` | Speed modifier | Number `0.05..5` |
| `damageDealtMultiplier` | Outgoing damage modifier | Number `0..10` |
| `damageTakenMultiplier` | Incoming damage modifier | Number `0..10` |
| `periodic` | Optional periodic action block | See below |

### `mechanics.statuses[].periodic`

| Field | Accepted values |
| --- | --- |
| `everyTicks` | Integer `1..1200` |
| `actions` | At least one mechanic action |

## `mechanics.resources[]`

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Resource identifier | 1-96 chars, ID format |
| `name` | Resource name | 1-36 chars |
| `color` | UI/render color | `#rrggbb` |
| `max` | Resource cap | Number `1..100000` |
| `start` | Starting value | Number `0..max` |
| `regenPerTick` | Passive regen or decay | Number `-100..100` |

## `mechanics.triggers[]`

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Trigger identifier | 1-96 chars, ID format |
| `name` | Optional friendly name | 1-48 chars |
| `event` | Trigger hook | `onCast`, `onHit`, `onDamageTaken`, `onStatusApplied`, `onStatusExpired`, `onKill`, `onLowHp` |
| `conditions` | Optional gating conditions | Zero or more supported condition blocks |
| `actions` | Trigger results | At least one supported action block |

### Supported condition kinds

| Kind | Fields |
| --- | --- |
| `hasStatus` | `target: source|target`, `statusId` |
| `missingStatus` | `target: source|target`, `statusId` |
| `hpBelow` | `target: source|target`, `ratio: 0..1` |
| `resourceAtLeast` | `target: source|target`, `resourceId`, `amount: 0..100000` |
| `slotUsed` | `slot: 0..3` |
| `abilityTag` | `tag` |

### Supported action kinds

| Kind | Fields |
| --- | --- |
| `applyStatus` | `target: source|target`, `statusId`, optional `durationTicks: 1..3600`, optional `stacks: 1..50` |
| `removeStatus` | `target: source|target`, `statusId` |
| `dealDamage` | `target: source|target`, `amount: 0..10000`, optional `color` |
| `heal` | `target: source|target`, `amount: 0..10000` |
| `knockback` | `target: source|target`, `force: 0.05..12`, optional `direction: sourceToTarget|targetToSource|aim`, optional `color` |
| `slow` | `target: source|target`, `multiplier: 0.05..1`, `durationTicks: 1..1200`, optional `color` |
| `modifyResource` | `target: source|target`, `resourceId`, `amount: -100000..100000` |
| `flashEffect` | `target: source|target`, `radius: 0.05..30`, optional `color` |

Practical note:

- Trigger and periodic-action references are validated. If you reference a missing status or resource, the ruleset is rejected.

## NPC Configuration

`npcs` is optional. If you omit it entirely, it becomes empty arrays for archetypes, lab spawns, and session spawns.

## `npcs.archetypes[]`

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | NPC identifier | 1-96 chars, ID format |
| `name` | NPC name | 1-36 chars |
| `hue` | Render hue | Integer `0..359` |
| `team` | Default team | 1-96 chars, ID format |
| `hpMultiplier` | HP scale | Optional number `0.05..20`, defaults to `1` |
| `speedMultiplier` | Speed scale | Optional number `0..5`, defaults to `1` |
| `loadout.abilityIds` | NPC ability list | Up to 4 valid ability IDs |
| `behavior.mode` | AI behavior | `idle`, `wander`, `seek`, or `kite` |
| `behavior.aggroRange` | Acquire range | Optional number `0..100`, defaults to `18` |
| `behavior.preferredRange` | Desired range | Optional number `0..100`, defaults to `5` |
| `behavior.wanderRadius` | Wander radius | Optional number `0..100`, defaults to `5` |
| `casting.slots` | Which loadout slots the NPC may cast | Optional slot indexes `0..3`, unique and sorted |
| `casting.minRange` | Minimum cast distance | Optional number `0..100`, defaults to `0` |
| `casting.maxRange` | Maximum cast distance | Optional number `0..100`, defaults to `18`, must be `>= minRange` |

## `npcs.labSpawns[]` and `npcs.sessionSpawns[]`

These two arrays share the same spawn shape.

| Field | Purpose | Accepted values |
| --- | --- | --- |
| `id` | Spawn identifier | 1-96 chars, ID format |
| `archetypeId` | Which NPC to spawn | Must reference an archetype |
| `x` | Spawn X | Number `-200..200` |
| `y` | Spawn Y | Number `-200..200` |
| `team` | Optional team override | 1-96 chars, ID format |

Practical note:

- `labSpawns` are used only in `Lab`.
- `sessionSpawns` are used in `Solo` and `Host`.

## What Is Not Configurable Today

These values exist at runtime, but you do not configure them through the Rules JSON:

- Transport is always `webrtc`.
- Room IDs and peer IDs are generated at runtime.
- `rulesetHash` is always computed from the validated ruleset.
- `playerCount`, `createdAt`, and `lastHeartbeat` are runtime values.
- Room status is not a user-facing rules knob.

## Current Default Preset At A Glance

The shipped default preset currently uses:

- `id: beat-arena-v9`
- `name: Beat Arena Physics Lab V9`
- `tickRate: 30`
- `maxPlayers: 6`
- `mapBundleId: local-grid-arena`
- `contentHash: local-content-v9`
- Arena size `38 x 24`
- 4 static obstacles
- 6 defined abilities
- 4 slotted player abilities
- 3 statuses
- 2 resources
- 6 triggers
- 3 NPC archetypes
- 1 lab spawn