# Hosted Room Protocol

## Client To Host

```ts
type ClientToHost =
  | { type: 'hello'; displayName: string }
  | {
      type: 'input';
      input: {
        sequence: number;
        moveX: number;
        moveY: number;
        aimDx: number;
        aimDy: number;
        primaryPressed: boolean;
        sampledAtMs: number;
      };
    };
```

## Host To Client

```ts
type HostToClient =
  | { type: 'welcome'; playerId: string; room: RoomInfo; ruleset: Ruleset }
  | { type: 'snapshot'; snapshot: EngineSnapshot }
  | { type: 'notice'; message: string };
```

Snapshots include players, active projectiles, and short-lived visual effects. Player snapshots include HP, alive/respawn state, last input sequence, and local-primary cooldown.

## Authority

The host's worker is the authority for:

- entity spawn/removal
- collision and movement
- hit detection
- ability cooldowns, projectile/melee resolution, HP, death, and respawn
- tick number
- snapshot publication

Peers are authority only for their own input stream. Rule/content hashes are advertised, not enforced by a central anti-cheat system.
