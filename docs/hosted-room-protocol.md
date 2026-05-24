# Hosted Room Protocol

## Client To Host

```ts
type ClientToHost =
  | { type: 'hello'; displayName: string }
  | { type: 'ping'; sentAtMs: number }
  | {
      type: 'input';
      input: {
        sequence: number;
        moveX: number;
        moveY: number;
        aimDx: number;
        aimDy: number;
        castSlots: number[];
        slotPresses: number[];
        slotReleases: number[];
        sampledAtMs: number;
      };
      redundantInputs?: {
        sequence: number;
        moveX: number;
        moveY: number;
        aimDx: number;
        aimDy: number;
        castSlots: number[];
        slotPresses: number[];
        slotReleases: number[];
        sampledAtMs: number;
      }[];
    };
```

## Host To Client

```ts
type HostToClient =
    | { type: 'welcome'; playerId: string; room: RoomInfo; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: NetworkSnapshot }
  | { type: 'notice'; message: string }
  | { type: 'host-closed' }
  | { type: 'pong'; sentAtMs: number; receivedAtMs: number };
```

Snapshots include players, active projectiles, short-lived visual effects, and combat text. Player snapshots include HP, alive/respawn state, last input sequence, four loadout slot cooldowns, aim direction, body facing direction, last-used slot, optional status effects, and optional charge state.

In the live network protocol, `snapshot` payloads are sent as compact `NetworkSnapshot` objects and omit `mechanicTraces` and `aiTraces` to reduce bandwidth.

If a peer reaches the host when room capacity is already reached, the host sends a `notice` (`room is full`) followed by `host-closed` and closes that peer session.

## Authority

The host's worker is the authority for:

- entity spawn/removal
- collision, movement mode, and facing
- hit detection
- ability cooldowns, charge timing, ability effects, projectile/melee resolution, HP, death, and respawn
- tick number
- snapshot publication

Peers are authority only for their own input stream. Rule/content hashes are advertised, not enforced by a central anti-cheat system.
