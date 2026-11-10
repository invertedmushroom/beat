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

1. User edits JSON in the menu textarea.
2. `applyRulesJson()` parses `parseRulesetJson()` and validates via `validateRuleset()`.
3. If valid, `hashRuleset()` computes the ruleset hash, and the app updates the inspector.
4. Starting `Solo`, `Lab`, or `Host` works only with a validated ruleset.
5. The host advertises `rulesetHash`, `contentHash`, and `mapBundleId` from the selected ruleset.

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
