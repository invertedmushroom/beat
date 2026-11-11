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
5. accepts data channels opened by each client:
   - a control channel for `hello`, `welcome`, `ping`, `pong`, and session-level notices
   - an input channel for client-to-host input messages (unordered, limited retransmit)
   - a snapshot channel for host-to-client gameplay state (unordered, no retransmit)
   - a separate reliable, ordered keyframe channel when codec v2 is negotiated
   - labels are `beat-control`, `beat-input`, `beat-snapshot`, `beat-keyframe`, with legacy support for `beat`
6. on `hello`, assigns a player ID and adds the remote player to the engine.
   - if room capacity has been reached, the host sends `notice: room is full` and immediately closes that peer session.
7. on `input`, forwards the player input to `engine.submitInput()`.
8. broadcasts binary snapshots over each client's dedicated snapshot channel when the client negotiates `snapshotProtocol: 1` in `hello`.

Control messages are JSON-serialized and include:

- `welcome` with assigned playerId, room info, and ruleset
- `notice` text messages
- `host-closed`
- `pong` responses to client latency checks

Clients without binary negotiation receive the legacy JSON `snapshot` message. New clients also accept legacy JSON snapshots from older hosts.

### Client side

`src/net/webrtc.ts` also contains `ClientSession`.
The client:

1. optionally records a join request via the directory when the backend supports it.
2. creates an RTCPeerConnection and four data channels (`beat-control`, `beat-input`, `beat-snapshot`, `beat-keyframe`). Older hosts ignore the extra channel.
3. sends `offer` to the host through the directory.
4. receives `answer` and ICE candidates through directory signals.
5. on open channel, sends `hello` with display name.
6. handles `welcome` and begins rendering snapshots.
7. sends `input` messages to the host as the local player moves.
8. if no host message arrives before the first snapshot timeout window, the client disconnects and reports a connection timeout.

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

Practical behavior note:

- join requests are a ledger and admission check point, but there is no manual host approval UI yet.
- in STDB mode, a new join request is rejected when the room is already at capacity.

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
When player count reaches capacity, room status is advertised as `full` and new joins are rejected.
If the host closes the room, the directory removes it and notifies subscribers.
The private STDB `hosted_room_sweep` schedule runs every five seconds without a connected browser. It removes rooms after eight seconds without a heartbeat, cascades their peers and signals, removes orphan peers, expires pending joins after 60 seconds, and expires signals after 120 seconds. Accepted peers remain while their host's lease is live because the host owns their admission and player count.

The schedule is seeded idempotently on init, connection, and room advertisement so existing databases acquire it after a module update. The public `pruneHostedRooms` reducer remains available for refreshes. Expired rooms reject joins and signaling before the next sweep. Advertisements use the owner-checked `createHostedRoom` upsert so a host can restore a swept lease after suspension. Session shutdown suppresses further advertisements.

## Local directory fallback

`src/rooms/localDirectory.ts` is a browser-only implementation for quick same-origin testing.
It stores rooms and signals in `localStorage`, broadcasts changes over `BroadcastChannel`, and prunes stale entries every second.

## Message formats

`src/net/messages.ts` defines the JSON wire format.

Client-to-host:

- `{ type: 'hello', displayName, snapshotProtocol?: 1, snapshotCodecVersion?: 2 }`
- `{ type: 'input'; input, redundantInputs?: PlayerInput[] }`
- `{ type: 'ping'; sentAtMs }`
- `{ type: 'snapshot-ack'; tick }` (completed binary snapshot, or `-1` to request a keyframe)

Host-to-client:

- `{ type: 'welcome'; playerId, room, ruleset }`
- `{ type: 'snapshot'; snapshot }`
- `{ type: 'notice'; message }`
- `{ type: 'host-closed' }`
- `{ type: 'timing'; timing }`
- `{ type: 'pong'; sentAtMs, receivedAtMs, serverSentAtMs?, timing? }`

Practical note:

- The host accepts optional `redundantInputs` to help repair out-of-order or dropped client input sequences.
- The `ping`/`pong` handshake also synchronizes clocks and the input send phase.
- The network snapshot payload is intentionally compact and excludes trace arrays for smaller messages.

## Practical notes

- The host is authoritative. Clients predict local input and smooth remote state for rendering.
- Hosts and clients both rely on the directory only for discovery and signaling.
- The live gameplay data channel is separate from STDB room metadata.
- STDB adds a join ledger; local and HTTP backends only need room discovery plus offer/answer/ICE delivery.
- If STDB is unavailable, `localDirectory` remains a valid same-origin test mode, and `httpDirectory` remains available for a remote edge-backed deployment.

## Affine clock sync and input pacing

`src/net/clockSync.ts` fits `T_server = a * T_client + b` from four timestamps: client send (`sentAtMs`, T1), host receive (`receivedAtMs`, T2), host send (`serverSentAtMs`, T3), and client receive (T4). Host timestamps and worker deadlines use `performance.timeOrigin + performance.now()` to bridge worker and main-thread clock origins. Client timestamps use local `performance.now()`.

RTT excludes host processing time: `(T4 - T1) - (T3 - T2)`. Midpoint samples near the minimum RTT form a centered least-squares fit over at most 64 samples and 60 seconds. Drift is bounded to 1,000 ppm. Invalid samples are rejected. A long sample gap resets the fit. Each pong can carry the worker's tick, interval, and next deadline. The worker publishes its actual accumulator deadline after catch-up or discarded backlog.

`EngineClient.onTiming()` also feeds the host's phase detector. When the worker deadline shifts by more than 3 ms modulo the tick interval, the host pushes an unsolicited `timing` notice over control. The client cancels and reschedules a pending input send against the new phase immediately. A phase notice does not refresh the age of the NTP fit or permit an older worker timeline to replace a newer one. Normal tick advances do not produce control notices. Session teardown removes the timing subscription.

`ClientSession` paces sends from its bounded `PendingInputQueue` to estimate arrival **20 ms before a worker deadline**, using half the filtered RTT for one-way transit. A paced send takes the newest movement state and redundant unacknowledged skill events. Canonical `PlayerInput` stays unchanged. Timers and clock state reset on reconnect or teardown. Until timing is available, or after five seconds without a fresh sample, inputs send immediately.

The 15–25 ms arrival window is a target under stable, approximately symmetric paths. RTT asymmetry, browser timer stalls, and host suspension can move actual arrival outside that window. `NetDiagnostics` exposes the fitted rate, offset, and sample count.

## Quantized snapshots and acknowledged baselines

`src/net/snapshotCodec.ts` owns one encoder per host peer and one decoder per client transport. `snapshotBinary.ts` encodes typed binary values and recursive object/array changes with a fixed field-name dictionary. Arena coordinates (`x`, `y`, `anchorX`, `anchorY`) map from centered arena bounds to unsigned 16-bit integers. Values outside the arena clamp to its bounds. Maximum in-bounds error is half a cell (`extent / 131070`). Velocities and other non-integer numeric state retain float64 precision. Mechanic and AI traces remain local.

The host prepares one immutable quantized tree per broadcast, lazily when a peer actually encodes it. All peers share that current state while retaining independent acknowledged baselines. Each encoder reuses a bounded `Uint8Array` writer and its `DataView`, rewinding unchanged subtrees instead of allocating a writer per node. Final packet buffers are independent copies. Preparation, packets, strings, and decoding still allocate. The repeatable encoding benchmark is `npx vitest bench --run src/net/snapshot.bench.ts`.

Clients advertise `snapshotProtocol: 1` plus optional `snapshotCodecVersion: 2`. Keeping the original opt-in field lets older hosts accept hello and reply with codec v1. Hosts send v1 to peers without the v2 field. Packet header byte 2 identifies the codec version. V2 matches entity arrays by stable IDs and encodes contiguous runs of baseline indices plus changed entries, preserving exact order across insertion, removal, and reordering. A head despawn therefore does not rewrite the surviving tail. V1 retains positional array changes. Both versions keep a single acknowledged frame baseline per peer.

The current unreleased v2 dictionary includes `jumpHeld` as ID 88. V1 writers emit this field as a literal name. There are no deployed peers requiring a separate version for this dictionary addition.

Every frame names its tick and baseline tick. The host references only a frame that this client completed and acknowledged, never the previous send. Both ends keep at most 64 baseline states, retaining the currently acknowledged/referenced baseline within that budget during delayed ACKs. Clients publish strictly increasing, fully reconstructed and validated snapshots. Lost, duplicate, reordered, corrupt, and incomplete packets cannot regress published state. Missing baselines request a keyframe over reliable control. The host also sends a keyframe every two seconds of simulation time and whenever its acknowledged baseline is unavailable, subject to channel backpressure and an in-flight recovery frame.

Each binary message is at most **1,000 bytes**, including a 24-byte versioned header. This leaves transport overhead headroom without guaranteeing fragmentation behavior for every path. Routine movement deltas fit a single message. Larger frames split without dropping gameplay entities. The header carries tick, baseline, total length, fragment index/count, and a frame checksum. A frame is published and acknowledged only after all fragments arrive. `beat-snapshot` remains `{ ordered: false, maxRetransmits: 0 }`, with four pending datagram frames, a one-second assembly window, and a 256 KiB maximum frame.

V2 keyframes use `beat-keyframe`, a reliable ordered channel separate from control and ordinary deltas. After processing welcome and creating its decoder, the client sends `snapshot-ack: -1` to enable initial keyframe delivery, preventing cross-channel ordering from delivering the keyframe before welcome. Each peer has at most one outstanding keyframe. Deltas continue against a usable acknowledged baseline while a periodic keyframe is in flight. With no usable baseline, the host waits for recovery rather than queuing full frames every snapshot interval. A keyframe may retry after five seconds only when its channel queue has drained. Its single reassembly slot allows 15 seconds and cannot be evicted by incomplete datagrams. All channels still share the peer connection's congestion and bandwidth limits. V1 retains unreliable keyframes; legacy JSON snapshots retain their original size behavior.

## Local input prediction

The host attempts a snapshot for every worker tick. Per-peer tick guards coalesce
duplicate or older ticks, and channel backpressure skips congested sends. There is
no fixed 50 ms send gate, which previously reduced steady 30 Hz simulation updates
to roughly 15 snapshots per second. Higher tick rates increase snapshot traffic;
the existing channel queue and keyframe limits remain in effect.

`src/engine/playerMovement.ts` supplies the worker and local input replay with the same movement modes, facing, aim fallback, and strongest-slow calculation. Input sampling follows the active ruleset's tick rate. Replay skips acknowledged sequences and advances each remaining input by one tick from the authoritative anchor.

`replayPendingInputs()` expires slows by remaining ticks and applies charge presses before movement. Charge releases and automatic releases take effect after movement, matching worker order. Cooldowns prevent invalid charge starts. Optional `PlayerSnapshot.jumpHeld` preserves the held jump edge in platform mode. The canonical `PlayerInput` format is unchanged.

Once WASM is ready, local replay integrates desired velocity in the isolated Rapier world with player damping, platform gravity, and static arena colliders. Before initialization, local replay uses a numerical approximation. Free-aim self-dashes use the worker's shared bounded displacement rule, including arena and obstacle limits. Casts and charge releases displace the player before Rapier integrates the selected movement velocity. Duplicate input sequences and cooldowns prevent a dash from applying twice during replay. Aim-assisted dashes depend on authoritative target selection. Incoming knockback, dynamic collisions, tethers, combat, and resource-dependent outcomes remain authoritative. Sequence-based replay approximates host input coalescing during hitches.

The smoother stores at most 128 predicted future tick positions before authority arrives. A sample matches only when its tick, input sequence, and observed player life agree with the arriving snapshot. Death or respawn clears future samples. Missing or mismatched samples produce no ghost and no prediction-error measurement. This keeps ordinary movement between different simulation times out of the error metric.

Predicted movement and dashes render immediately. Reconciliation adjusts a separate visual offset. Errors within two arena quantization cells (with a 1 mm minimum) add no offset. Small offsets decay exponentially at 9 per second. Above `max(0.15 m, radius / 2)`, the decay rate increases toward 24 per second. Corrections at `max(2.4 m, 5 * radius)` snap immediately. A correction offset that would place the visual player inside static geometry also clears immediately. `snapCorrections` counts those correction events, rather than large predicted movement.

[Replay recordings](replays.md) retain authoritative snapshots and client prediction diagnostics for inspecting these corrections.

## Collision-constrained remote dead reckoning

`src/net/collisionPrediction.ts` owns an isolated browser Rapier world with the same arena walls, rectangular obstacles, and player radius as the authoritative worker. `SnapshotSmoother` retains its two-tick interpolation buffer. During a short gap it replays a remote player's authoritative position and velocity through at most three fixed physics ticks, with a fractional final step, CCD, wall sliding, and platform gravity when configured. Each render starts from the authoritative anchor so repeated renders do not accumulate prediction twice. Beyond that horizon the predicted position freezes.

The predictor handles static arena collisions. Player-to-player collisions, dynamic bodies, abilities, and combat remain authoritative and correct on the next snapshot. Until WASM initialization completes, remote extrapolation holds the authoritative position. Replacing a smoother or leaving the session frees its Rapier world, including initialization that resolves after disposal.

## Dynamic body rendering

`SnapshotSmoother` retains at most 12 samples per live physics body and objective.
Dynamic positions use cubic Hermite interpolation with authoritative velocity tangents
and the actual time between the bracketing ticks, on the same two-tick delayed timeline
as remote players. Relic objectives with a body ID copy the rendered body's position
and velocity so the objective ring and ball remain aligned. Other gameplay fields
retain their latest authoritative values.

For relics configured to reset on score, a cooldown above its expected remaining
value clears the affected interpolation history. The comparison subtracts elapsed
simulation ticks, so skipped snapshots cannot hide a renewed cooldown. Scoring a
non-resetting relic preserves its timeline. Changed body IDs also clear history.
Despawns remove history. A Hermite point inside static geometry falls back to linear
interpolation, then to a bracketing anchor if needed. During gaps beyond available
samples, dynamic bodies hold their newest authoritative anchor. This rendering layer
does not predict player-ball impulses or replay dynamic contacts locally.
