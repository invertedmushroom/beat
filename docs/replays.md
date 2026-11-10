# Snapshot replays

Solo, Lab, Host, and Client sessions record received authoritative snapshots in memory. Use **Save replay** during a session, or return to **Menu** and select **Watch last replay** or **Export replay**. **Import replay** opens an exported `.beat` file. Playback starts paused and provides a timeline, previous/next simulation tick, and 0.5×, 1×, and 2× speed. Imported rules configure the arena renderer.

The latest recording survives returning to the menu. A new session replaces that recording. A page reload discards in-memory recordings. Export a file to retain a clip across reloads. An invalid import leaves the previous clip available.

## Scope and ownership

The replay shows authoritative state with position interpolation between samples. Client recordings also show the recorded pending input count, prediction error EWMA, and correction count. These diagnostics describe the live session. Playback does not reconstruct the original predicted render, execute inputs, or resimulate physics. Recorded snapshots exclude mechanic and AI traces, as network snapshots do.

`ReplayRecorder` owns its own encoder and acknowledges each recorded tick immediately. Recording cannot advance a transport encoder's baseline. `ReplayPlayer` owns an independent decoder and restores from the nearest checkpoint when seeking backward or across a large interval. Interpolation matches entity IDs and keeps player death and respawn transitions discrete.

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
| Frame flags | `u8`: bit 0 checkpoint, bit 1 diagnostics |
| Tick and packet count | `u32`, `u16` |
| Optional diagnostics | Pending inputs `u16`, prediction error `f64`, correction count `u32` |
| Packets | Repeated `u16` byte length followed by snapshot packet bytes |

Frames continue to end of file. Each packet is at most 1,000 bytes and uses the existing checksummed snapshot codec. Every delta names the preceding recorded tick as its baseline. The first frame is a checkpoint. Fragment indices must match the frame record. These rules let seeking restore a checkpoint without depending on evicted state.

Import validates the complete file before publishing a clip: file size, metadata and rules, increasing ticks, frame count, retention span, fragment indices, baseline chain, packet checksums, snapshot shape, diagnostics, and drawing geometry. The file cap is 16 MiB plus 1 MiB of metadata plus the 12-byte archive header. A checksum detects corruption and does not establish who created a file.

Changes to the archive layout require a new archive version and an explicit reader compatibility decision. Changes to packet encoding follow the networking codec version independently.
