# Beat Architecture

## High-level flow

- `index.html` loads `src/main.ts`.
- `src/main.ts` constructs the app and mounts the UI.
- `src/app.ts` is the main application controller: it manages menu state, room modes, rule editing, engine startup, and networking.
- `src/engine/worker.ts` runs the authoritative simulation in a Web Worker.
- `src/net/webrtc.ts` manages host/client WebRTC sessions and snapshot/input messaging.
- `src/rooms/spacetimeDirectory.ts`, `src/rooms/httpDirectory.ts`, and `src/rooms/localDirectory.ts` provide room discovery and signaling backends.
- `src/engine/rulesValidation.ts` validates the JSON rule schema before starting a game.

## Main app modes

`src/app.ts` supports six runtime modes:

- `idle`: initial lobby state.
- `solo`: single-player game using the current ruleset.
- `lab`: local authoring/test harness using `labSpawns`.
- `host`: multiplayer host with room advertising and peer connections.
- `client`: joined player connected to a host over WebRTC.
- `replay`: visual playback of a retained or imported snapshot recording.

### Mode behavior

- `Solo` uses `ruleset.npcs.sessionSpawns` to populate session actors and does not advertise a room.
- `Lab` uses `ruleset.npcs.labSpawns`, shows lab control UI, and can spawn additional NPC archetypes.
- `Host` creates a `RoomInfo` advertisement and starts a `HostSession` for direct peer signaling.
- `Client` joins a selected room and receives the host's ruleset via WebRTC welcome.

## Rules pipeline

1. User selects a match kit or edits rules through the workbench and Advanced JSON.
2. `applyRulesJson()` parses `parseRulesetJson()` and validates via `validateRuleset()`.
3. If valid, `hashRuleset()` computes the ruleset hash, and the app updates the inspector.
4. Starting `Solo`, `Lab`, or `Host` works only with a validated ruleset.
5. The host advertises `rulesetHash`, `contentHash`, and `mapBundleId` from the selected ruleset.

### Library and current configuration

`src/ui/workbench/kits.ts` owns the authored catalog and `compileKit(selection)`.
The compiler rebuilds a complete `Ruleset` from either a match kit or an experiment
preset, combining movement chassis (`twinStick`, `tank`, `orthogonal`, `platform`),
four ability IDs, mutators, an optional bouncy relic, and optional mechanic addons
(`combos`, `bleed-dot`, `execute`). It validates the result through the existing rules
validator and applies each mutator once to fresh catalog values. Match kits start
without combo triggers or resources unless explicitly toggled on; experiment presets
retain their baseline mechanics and allow the same movement, ability, mutator, and
bouncy relic overrides.

`src/ui/workbench/kitsView.ts` owns the card markup, control translation, and UI
synchronization. `BeatApp` retains the selection with its compiled rules fingerprint
and passes the output through `commitWorkbenchRules()`. When accepted rules differ
from that fingerprint, the app detaches the selection and preserves the custom rules.
Typing JSON detaches the selection immediately, including invalid drafts. Selecting
a new match or complete experiment card explicitly replaces the draft; selecting an
addon experiment card (`bleed-dot`, `execute`) composes onto the active kit or clones
and extends custom rules. Kit selections are session state; exports and hosted peers
receive ordinary compiled rules without kit metadata.

Library is the initial workbench tab and the lobby's single configuration entrypoint.
Matches contains complete match kits. Experiments contains complete arena/mechanic
presets. The separate Add mechanics section contains composable mechanic packages.
`experiments.ts` owns those builders and the
toggleable mechanic packages (`MECHANIC_PRESETS`: Combo Mechanics, Bleed Over Time,
Low HP Execute) exposed both in the Library and in the Mechanics tab.

`configurationView.ts` derives the current arena, movement summary, and four ability
cards from accepted rules. Custom edits detach recipe controls but keep these cards
available for inspection and editing. The lobby derives its summary from the same rules.
When JSON is invalid, both views identify the displayed configuration as the last valid
one. Starting play routes the user to the invalid draft instead of starting a worker.

`movementView.ts` owns the single movement-package picker in the Player tab, beside
the detailed movement fields. Attached recipes recompile through `compileKit()`.
Custom rules use `withMovementPackage()`, which changes only movement tuning and aim.

The Abilities tab inspects one selected ability at a time (`#workbench-ability-select`).
`abilityView.ts` derives its schematic, timings, effect nodes, and potential trigger
links from accepted rules. It holds no separate graph state. Effect links reach the
existing field editor. Trigger links select the existing Mechanics editor. The Lab
action starts the current loadout without equipping the inspected ability. The Library
retains ownership of the four loadout pickers. The Mechanics tab provides 1-click mechanic package
toggles alongside trigger add/remove controls (`#workbench-add-trigger`,
`#workbench-remove-trigger`), hiding the trigger detail editor when a ruleset has no
triggers. Library and Mechanics package controls use the same renderer and toggle
operation. Invalid JSON disables package changes until the draft is repaired or replaced.

Structured input commits skip unchanged values, so a subsequent blur/change event does
not rebuild the next focused field. Existing delegated workbench listeners own library
and editor actions.

Library play buttons use the existing Solo and Host entrypoints. The Bouncy Relic option
is available on any Relic Push ruleset and changes only relic body tuning. Players
can push the ball through Rapier body contacts or strike dynamic physics bodies with
projectile and melee abilities (impulse scaled by damage, knockback force, and charge),
while existing objective logic owns goals, scoring, and resets. Player movement and
network formats are unchanged.

## Networking

### Directories

- `src/rooms/localDirectory.ts` is the browser-local directory and signaling transport using `localStorage`, `BroadcastChannel`, and periodic pruning.
- `src/rooms/httpDirectory.ts` is the HTTP/SSE-backed directory and signaling transport for remote edge deployments.
- `src/rooms/spacetimeDirectory.ts` connects to SpacetimeDB and uses generated reducer bindings for hosted-room advertisement, join requests, and signals.

### WebRTC

- `src/net/webrtc.ts` has `HostSession` and `ClientSession`.
- The host uses STDB/local directory signals to exchange offers/answers/ICE.
- Once established, the host uses separate data channels: reliable control, partially reliable input, best-effort snapshot deltas, and a reliable keyframe channel for codec v2.
- The host remains authoritative for simulation and broadcasts snapshots to clients.
- `src/net/clockSync.ts` estimates the affine host clock from control-channel NTP timestamps. `ClientSession` paces the input ring against worker tick deadlines.
- `src/net/snapshotCodec.ts` owns shared quantized preparation, per-peer acknowledged baselines, bounded fragmentation, and atomic reconstruction. `snapshotBinary.ts` owns the reusable binary writer and ID-matched array patches in codec v2.
- `src/net/collisionPrediction.ts` owns the visual Rapier world used by `SnapshotSmoother` for local input replay and short remote packet gaps. The smoother disposes that world with the client session.
- See [networking.md](networking.md) for wire formats, recovery limits, and timing assumptions.

## Engine runtime

### Entry points

- `src/engine/worker.ts` defines the simulation world and runtime state.
- `EngineClient` on the main thread communicates with the worker.
- The worker keeps all game state and publishes snapshots.
- The worker publishes its next accumulator deadline in the absolute monotonic host clock. `EngineClient` caches that timing for pongs and emits timing updates to the host's phase detector. The host pushes phase changes over control so clients can reschedule pending inputs without waiting for another ping.

### Players and NPCs

- Players are stored in `players: Map<string, RuntimePlayer>`.
- `addPlayer()` creates a Rapier body, sets `team`, `hp`, `maxHp`, `statuses`, and `resources`.
- Team selection is available via `spawn.team`, `npc.team`, or default assignment.
- The local host player is placed on team `players`.
- `src/engine/playerMovement.ts` owns desired movement velocity, facing, aim fallback, strongest-slow selection, and bounded static displacement. The worker uses the displacement rule for dashes and knockback. Local input replay uses the same rule for free-aim self-dashes. The worker retains ownership of damage, target selection, dynamic bodies, and constraints.
- Player snapshots include optional `jumpHeld` state so platform input replay preserves jump edges across authoritative snapshots. Older snapshots default to an unheld jump.

### Physics and collision

- Static obstacles are created with fixed Rapier bodies.
- Projectiles and melee hit detection use distance tests and actor filtering.
- `sameTeam(owner, target)` blocks friendly-fire and same-team targeting for NPC AI.

### Resources and mechanics

- Resources are initialized from `ruleset.mechanics.resources` using `initialResources()`.
- `regenerateResources()` applies `regenPerTick` every tick.
- `modifyResource()` updates values, clamps to `[0, max]`, and creates resource combat text/effects.
- Triggers use `resourceAtLeast` and `modifyResource` for conditional mechanics.

### Healing

- Heal effects are handled by `healPlayer()`.
- `applySelfEffects()` processes `heal` effects targeting `self`.
- `applyHitEffect()` handles `heal` effects targeting `hit`.
- Healing only applies if the player is alive and the amount is positive.

## Replays

- `src/replay/archive.ts` owns an independent snapshot baseline chain, bounded retention, and validated `.beat` import/export. Each delta refers to the preceding recorded frame. Checkpoints make retained clips independently decodable after eviction. Client diagnostics can include a prediction position quantized to four bytes.
- `src/net/snapshotSmoothing.ts` retains at most 128 future prediction samples. It matches an arriving authoritative tick by input sequence and observed player life before publishing the recorded prediction or measuring correction error. Correction offsets decay separately from predicted movement.
- `src/replay/player.ts` owns seeking, playback time, and interpolation. It restores snapshot decoders from checkpoints and publishes visual snapshots with an optional aligned prediction ghost. `CanvasRenderer` owns drawing and clearing the ghost overlay.
- `src/ui/ReplayFeature.ts` owns the recording, retained clip, file reads, download URLs, and playback controls. `src/app.ts` wires playback to the existing renderer in `replay` mode. Playback starts no engine or network session.
- See [replays.md](replays.md) for retention, file format, and debugging scope.

## Room metadata

When hosting, the room advertisement contains:

- `roomId`, `hostPeerId`: runtime-generated IDs.
- `name`: lobby room title.
- `rulesetId`: from the selected ruleset.
- `rulesetHash`: computed from the validated ruleset.
- `contentHash`, `mapBundleId`: from the ruleset.
- `playerCount`, `maxPlayers`: room capacity values.
- `transport`: always `webrtc`.
- `status`: `open`, `full`, or `closed`.
- `createdAt`, `lastHeartbeat`: runtime timestamps.

## Code ownership and editing

- `src/engine/rulesValidation.ts` defines the supported rule schema and validator ranges.
- `src/engine/protocol.ts` defines the TypeScript types for rules, abilities, mechanics, and snapshots.
- `src/app.ts` wires the UI, rules editing, room flow, and engine lifecycle.
- `src/engine/worker.ts` contains the actual simulation logic and runtime mechanics.
- `src/rooms/spacetimeDirectory.ts` contains STDB integration and hosted-room lifecycle.
