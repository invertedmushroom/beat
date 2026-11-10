# Snapshot replays

Solo, Lab, Host, and Client sessions record received authoritative snapshots in memory. Use **Save replay** during a session, or return to **Menu** and select **Watch last replay** or **Export replay**. **Import replay** opens an exported `.beat` file. Playback starts paused and provides a timeline, previous/next recorded sample, and 0.5×, 1×, and 2× speed. Imported rules configure the arena renderer. Step buttons pause playback and seek to adjacent recorded samples, including at ruleset tick rates above 30 Hz. From an interpolated position, stepping backward selects the preceding sample and stepping forward selects the following sample.

The latest recording survives returning to the menu. A new session replaces that recording. A page reload discards in-memory recordings. Export a file to retain a clip across reloads. An invalid import leaves the previous clip available.

## Scope and ownership

The replay shows authoritative state with position interpolation between samples. Client recordings also show the recorded pending input count, prediction error EWMA, and correction count. Enable **Prediction ghost** to overlay a translucent cyan ring at the predicted physics position. The connector and **Aligned error** compare that prediction with authority at the same simulation tick. The ghost records physics prediction before visual reconciliation, rather than the full original rendered frame. Playback executes no inputs or physics. Recorded snapshots exclude mechanic and AI traces, as network snapshots do.

The smoother captures future predictions before receiving their authoritative snapshots. A prediction is recorded only when tick, acknowledged input sequence, and observed player life match. Missing or mismatched samples display **No aligned prediction sample**. Ghost positions interpolate only when both surrounding samples exist in the same life. A death, respawn, or missing endpoint hides the interpolated ghost. Solo, Lab, and Host clips have no client prediction ghost. Leaving replay clears the overlay.

`ReplayRecorder` owns its own encoder and acknowledges each recorded tick immediately. Recording cannot advance a transport encoder's baseline. `ReplayPlayer` owns an independent decoder and restores from the nearest checkpoint when seeking backward or across a large interval. Position interpolation matches players, projectiles, physics bodies, and objectives by ID. Player facing and aim rotate along the shortest arc with unit-length directions. Exact half-turns rotate in the positive direction. Player death and respawn transitions, objective scoring, and entity creation remain discrete. A changed objective kind or body ID also keeps the objective position discrete.

`ReplayFeature` owns one recording and one retained clip. Its abort controller removes event listeners on destruction. It revokes download URLs after use or destruction. A session generation invalidates file reads that finish after leaving the menu or starting a session. Recording errors stop recording for that session and retain any completed clip. Gameplay continues.

## Retention

- At most five minutes of snapshots and 16 MiB of encoded frame records.
- At most 30 samples per second. Higher tick rates sample every `ceil(tickRate / 30)` ticks.
- Checkpoints occur at most two seconds apart during continuous recording. Eviction removes complete checkpoint groups, so a retained clip can be shorter than five minutes.
- An oversized group forces another checkpoint before exhausting the byte budget. A single snapshot that exceeds the budget stops recording.
- The byte budget covers encoded records. Rules metadata, snapshot encoder/decoder history, temporary imports, and renderer state require additional memory.

## File format version 1

All archive integers use little-endian order. Embedded snapshot packets retain the networking codec's big-endian header.

| Field | Encoding |
| --- | --- |
| Magic | Eight UTF-8 bytes: `BEATRPL1` |
| Metadata length | `u32`, at most 1 MiB |
| Metadata | UTF-8 JSON: version, validated ruleset, source mode, recording timestamp, optional local player ID |
| Frame flags | `u8`: bit 0 checkpoint, bit 1 diagnostics, bit 2 aligned prediction |
| Tick and packet count | `u32`, `u16` |
| Optional diagnostics | Pending inputs `u16`, prediction error `f64`, correction count `u32` |
| Optional aligned prediction | After diagnostics: arena-quantized `x` and `y`, two `u16` values (four bytes) |
| Packets | Repeated `u16` byte length followed by snapshot packet bytes |

Frames continue to end of file. An aligned prediction requires diagnostics, a Client source, and a local player ID in metadata. Its timestamp is the frame's tick. Existing records without the prediction flag keep their existing layout. Each packet is at most 1,000 bytes and uses the existing checksummed snapshot codec. Recordings use codec v2, including its `jumpHeld` dictionary entry. Every delta names the preceding recorded tick as its baseline. The first frame is a checkpoint. Fragment indices must match the frame record. These rules let seeking restore a checkpoint without depending on evicted state.

Import validates the complete file before publishing a clip: file size, metadata and rules, increasing ticks, frame count, retention span, fragment indices, baseline chain, packet checksums, snapshot shape, diagnostics, and drawing geometry. The file cap is 16 MiB plus 1 MiB of metadata plus the 12-byte archive header. A checksum detects corruption and does not establish who created a file.

The current archive format is unreleased. Optional diagnostics use frame flags. Snapshot packet encoding follows the networking codec version independently.
