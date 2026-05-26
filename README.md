# Beat

Beat is a standalone prototype for PWA-hosted arena rooms.

The important boundary: the browser can cache and run the game client, local rules, and Rapier2D simulation, but it does not host SpacetimeDB. The host PWA owns the live simulation and peers connect over WebRTC data channels. SpacetimeDB is the room directory, host identity record, join ledger, and WebRTC signaling mailbox.

## Play

[▶ PLAY NOW](https://invertedmushroom.github.io/beat/)

## Run

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5177`.

For a quick smoke test, press `Solo`, move with `WASD`/arrow keys, aim with the mouse, and cast skills with `Space`, left click, or `1`-`4`. Hold a charged skill to power it up; it fires automatically at full charge. On phones, use the left virtual joystick and press-drag-hold the right skill buttons to aim charged casts. Rules can switch movement between twin-stick and tank steering, and aim between free aim and body-facing casts.

For a quick multiplayer smoke test, open the app in two tabs:

1. In tab A, press `Host`.
2. In tab B, pick the room and press `Join`.
3. Move and fire in either tab.

By default the directory uses `localStorage` and `BroadcastChannel`, so it is same-origin and same-browser. Copy `.env.example` to `.env.local` and set `VITE_DIRECTORY_DRIVER=spacetime` to use STDB directly.

Using STDB changes room discovery and signaling only. Live gameplay still runs peer-to-peer over WebRTC data channels, so cross-network phone sessions can still fail during ICE negotiation on cellular, guest Wi-Fi, or other symmetric-NAT networks.

For public or mobile-friendly hosting, configure a real ICE source as well as STDB:

- set `VITE_ICE_SERVERS_URL` to a provider endpoint that returns a browser `iceServers` array
- or set `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` directly

Without TURN, the app is STUN-only and some phone-hosted or phone-joined sessions will time out while the peer connection stays at `ice checking`.

## Customizable Rules

The main menu exposes the active rules as JSON. Hosts can edit, paste, copy, or reset the rules before starting a room. The initial rules surface includes:

- arena size and static obstacles
- player speed, HP, radius, damping, respawn time, movement mode, and aim mode
- a four-slot loadout
- projectile and melee ability definitions with targeting, optional charge tuning, damage, cooldown, range, radius, color, effects, and shape-specific timing

Rules are locked once solo, host, or client play starts. The host remains authoritative for live simulation; clients receive the host rules in the WebRTC welcome message.

The workbench currently exposes Physics, Platform, Deathmatch, Duel, and King Zone presets.

## Documentation

- `docs/architecture.md` — implementation overview and component map.
- `docs/rules-implementation.md` — current rule schema and live semantics.
- `docs/room-config-guide.md` — user-facing room/rules configuration guide.
- `docs/engine-flow.md` — tick loop, physics, collision, status and resource updates.
- `docs/networking.md` — host/client, WebRTC, room directory, and STDB reducer interactions.

## SpacetimeDB

The STDB module is TypeScript under `spacetimedb/src/index.ts`. Generated browser bindings live in `src/module_bindings/`.

```powershell
npm run stdb:build
npm run stdb:generate
```

For local STDB:

```powershell
spacetime start
npm run stdb:publish:local
```

Use `VITE_STDB_URI=http://127.0.0.1:3000` and `VITE_STDB_DATABASE=beat-rooms-local`.

```bash
$env:VITE_STDB_URI="http://127.0.0.1:3000"
$env:VITE_STDB_DATABASE="beat-rooms-local"
```

For Maincloud:

```powershell
spacetime login
npm run stdb:publish:maincloud
```

Use `VITE_STDB_URI=https://maincloud.spacetimedb.com` and `VITE_STDB_DATABASE=beat-rooms`.

```bash
$env:VITE_STDB_URI="https://maincloud.spacetimedb.com"
$env:VITE_STDB_DATABASE="beat-rooms"
```

If you want public hosting to work across restrictive networks, also set either `VITE_ICE_SERVERS_URL` or explicit TURN env vars. STDB alone does not relay WebRTC traffic.
The root `spacetimedb` npm package is pinned to `2.1.0` to match the installed `spacetime` CLI. Upgrade the CLI and both package versions together.

## Architecture

- `src/engine/worker.ts` runs the authoritative Rapier2D movement, skills, HP, death, and respawn loop in a Web Worker.
- `src/net/webrtc.ts` owns host/client peer connections and snapshot/input messages.
- `src/input/InputController.ts` maps keyboard, mouse aim, and phone touch controls into the shared input contract.
- `src/rooms/localDirectory.ts` is a local room finder and signaling adapter.
- `src/rooms/spacetimeDirectory.ts` connects directly to STDB using generated TypeScript bindings.
- `src/rooms/httpDirectory.ts` is an optional HTTP/SSE directory adapter if an edge bridge is ever useful.
- `spacetimedb/src/index.ts` is the TypeScript STDB module for room listings, joins, ownership checks, signaling, and pruning.
- `docs/stdb-control-plane.md` documents the STDB control plane.

## Build And Check

```powershell
npm run lint
npm run build
npm run test
npm run test:e2e
```

The Vite build uses relative asset paths, so the generated `dist/` can be deployed from a GitHub Pages project path such as `/beat/`.

## GitHub Pages

This repo includes `.github/workflows/pages.yml`. Push to `main`, then in GitHub open `Settings -> Pages` and set `Source` to `GitHub Actions`.

The workflow builds the web app with:

```text
VITE_DIRECTORY_DRIVER=spacetime
VITE_STDB_URI=https://maincloud.spacetimedb.com
VITE_STDB_DATABASE=beat-rooms
```

If you need phone-friendly public hosting, add `VITE_ICE_SERVERS_URL` or explicit TURN env vars to the deployment as well. Otherwise the GitHub Pages build is STUN-only.

The STDB module is already published separately with `npm run stdb:publish:maincloud`; GitHub Pages only hosts the static PWA.
