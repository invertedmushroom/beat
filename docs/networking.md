# Networking

This document describes current host/client networking architecture, WebRTC flow, room directory interfaces, and STDB reducer interaction.

## High-level architecture

Beat uses a peer-hosted WebRTC architecture:

- The host runs the authoritative simulation and broadcasts snapshots.
- Clients send input to the host.
- Room discovery and signaling are separate from the live snapshot transport.

### Directory interfaces

`src/rooms/directory.ts` defines the shared directory API:

- `advertiseRoom(room)`
- `closeRoom(roomId)`
- `listRooms()`
- `subscribeRooms(listener)`
- `requestJoinRoom?(roomId, peerId, displayName)`
- `sendSignal(signal)`
- `subscribeSignals(peerId, listener)`
- `destroy()`

Three runtime backends currently exist:

- `src/rooms/localDirectory.ts`: browser-local discovery and signaling with `localStorage` and `BroadcastChannel`.
- `src/rooms/spacetimeDirectory.ts`: STDB-backed room directory and signaling.
- `src/rooms/httpDirectory.ts`: HTTP/SSE-backed directory and signaling for a remote edge service.

`src/rooms/directoryFactory.ts` selects the backend at startup:

- STDB when `VITE_DIRECTORY_DRIVER=spacetime` or STDB env vars are present.
- HTTP when `VITE_DIRECTORY_URL` is set.
- Local browser storage otherwise.

`requestJoinRoom` is optional because only the STDB backend currently records join requests in a server-side ledger. Local and HTTP backends still support room discovery and offer/answer/ICE signaling without that extra step.

## WebRTC host/client flow

### Host side

`src/net/webrtc.ts` contains `HostSession`.
The host:

1. advertises the room through the directory.
2. sends periodic heartbeat updates.
3. listens for `RoomSignal` events addressed to the host peer ID.
4. accepts `offer` signals, creates an RTCPeerConnection, and returns an `answer`.
5. opens a data channel for each client.
6. on `hello`, assigns a player ID and adds the remote player to the engine.
7. on `input`, forwards the player input to `engine.submitInput()`.
8. broadcasts `snapshot` messages to all open peer channels.

Host to client messages are JSON-serialized and include:

- `welcome` with assigned playerId, room info, and ruleset
- `snapshot` updates
- `notice` text messages
- `host-closed`

### Client side

`src/net/webrtc.ts` also contains `ClientSession`.
The client:

1. optionally records a join request via the directory when the backend supports it.
2. creates an RTCPeerConnection and data channel.
3. sends `offer` to the host through the directory.
4. receives `answer` and ICE candidates through directory signals.
5. on open channel, sends `hello` with display name.
6. handles `welcome` and begins rendering snapshots.
7. sends `input` messages to the host as the local player moves.

## Signaling and STDB

### STDB directory implementation

`src/rooms/spacetimeDirectory.ts` uses generated bindings from `src/module_bindings`.
It connects to a SpacetimeDB instance and performs:

- room advertisement via `createHostedRoom` and `heartbeatHostedRoom`
- room closure via `closeHostedRoom`
- join requests via `requestJoinHostedRoom`
- accepted-join state via `acceptJoinHostedRoom`
- signal persistence via `sendHostedRoomSignal`
- live updates via subscriptions on `hostedRoom` and `hostedRoomSignal`

### Hosted room schema

The STDB schema defines:

- `hosted_room` for room listing metadata
- `hosted_room_peer` for join requests and accepted peers
- `hosted_room_signal` for offer/answer/ICE transport

### Signal flow

Signals are exchanged as `RoomSignal` objects with:

- `signalId`
- `roomId`
- `fromPeerId`
- `toPeerId`
- `kind` (`offer`, `answer`, `ice`)
- `payload`
- `createdAt`

The host and client each subscribe to signals addressed to their peer ID.

### Room lifecycle

The host periodically re-advertises the room to keep it alive.
If the host closes the room, the directory removes it and notifies subscribers.
The STDB reducer `pruneHostedRooms` also removes stale rooms.

## Local directory fallback

`src/rooms/localDirectory.ts` is a browser-only implementation for quick same-origin testing.
It stores rooms and signals in `localStorage`, broadcasts changes over `BroadcastChannel`, and prunes stale entries every second.

## Message formats

`src/net/messages.ts` defines the JSON wire format.

Client-to-host:

- `{ type: 'hello', displayName }`
- `{ type: 'input', input }`

Host-to-client:

- `{ type: 'welcome', playerId, room, ruleset }`
- `{ type: 'snapshot', snapshot }`
- `{ type: 'notice', message }`
- `{ type: 'host-closed' }`

## Practical notes

- The host is authoritative; the client only renders received snapshots.
- Hosts and clients both rely on the directory only for discovery and signaling.
- The live gameplay data channel is separate from STDB room metadata.
- STDB adds a join ledger; local and HTTP backends only need room discovery plus offer/answer/ICE delivery.
- If STDB is unavailable, `localDirectory` remains a valid same-origin test mode, and `httpDirectory` remains available for a remote edge-backed deployment.
