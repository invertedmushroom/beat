# STDB Control Plane

Beat's PWA-hosted mode keeps per-frame state out of SpacetimeDB. STDB is the room directory, host identity record, join ledger, and WebRTC signaling mailbox. The implemented module is TypeScript in `spacetimedb/src/index.ts`; generated browser bindings are in `src/module_bindings/`.

## Tables

`hosted_room`

- `room_id: String`
- `host_identity: Identity`
- `host_peer_id: String`
- `name: String`
- `ruleset_id: String`
- `ruleset_hash: String`
- `content_hash: String`
- `map_bundle_id: String`
- `player_count: u32`
- `max_players: u32`
- `transport: String`
- `status: String`
- `created_at: Timestamp`
- `last_heartbeat: Timestamp`

`hosted_room_peer`

- `membership_id: String`
- `room_id: String`
- `peer_identity: Identity`
- `peer_id: String`
- `display_name: String`
- `state: String`
- `joined_at: Timestamp`
- `updated_at: Timestamp`

`hosted_room_signal`

- `signal_id: u64`
- `room_id: String`
- `from_peer_id: String`
- `to_peer_id: String`
- `signal_kind: String`
- `payload_json: String`
- `created_at: Timestamp`

## Reducers

- `create_hosted_room(...)`
- `heartbeat_hosted_room(room_id, player_count, status)`
- `close_hosted_room(room_id)`
- `request_join_hosted_room(room_id, peer_id, display_name)`
- `accept_join_hosted_room(room_id, peer_id)`
- `leave_hosted_room(room_id, peer_id)`
- `send_hosted_room_signal(signal_id, room_id, from_peer_id, to_peer_id, signal_kind, payload_json)`
- `prune_hosted_rooms()`

## Direct Browser Adapter

`src/rooms/spacetimeDirectory.ts` connects with generated `DbConnection` bindings:

- subscribes to `hosted_room` for the server selector
- calls `create_hosted_room` once per hosted room, then `heartbeat_hosted_room`
- calls `request_join_hosted_room` before a client sends an offer
- calls `accept_join_hosted_room` when the host answers
- subscribes to `hosted_room_signal` rows addressed to the local peer id
- stores the STDB anonymous auth token in `localStorage`

Set these build env vars for GitHub Pages:

```powershell
VITE_DIRECTORY_DRIVER=spacetime
VITE_STDB_URI=https://maincloud.spacetimedb.com
VITE_STDB_DATABASE=beat-rooms
```

## Optional HTTP/SSE Edge Contract

`src/rooms/httpDirectory.ts` still supports this transport shape. An edge service can map each route directly to the reducers/tables above.

- `GET /rooms -> RoomInfo[]`
- `PUT /rooms/:room_id` with a `RoomInfo` JSON body
- `DELETE /rooms/:room_id`
- `POST /signals` with a `RoomSignal` JSON body
- `GET /signals?peerId=... -> RoomSignal[]`
- `GET /events?peerId=...` as Server-Sent Events with `{ type: "rooms", rooms }` or `{ type: "signal", signal }`

## Rules

- The host identity owns room metadata.
- Signal reducers verify that the sender identity owns the source peer id, or owns the host peer id for the room.
- Room listings include `ruleset_hash` and `content_hash` so clients can decide whether to trust the host before opening a peer connection.
- STDB does not store live snapshots or full rules JSON; WebRTC data channels carry host rules, inputs, and snapshots.
- Signaling payloads should never contain gameplay secrets. They are short-lived SDP/ICE messages and are pruned by `prune_hosted_rooms`.
