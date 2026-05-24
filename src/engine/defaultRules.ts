import type { Ruleset } from './protocol';
import { validateRuleset } from './rulesValidation';

export function createDefaultRuleset(): Ruleset {
  return validateRuleset({
    id: 'beat-arena-v4',
    name: 'Beat Arena Skills V4',
    version: 4,
    tickRate: 30,
    maxPlayers: 6,
    mapBundleId: 'local-grid-arena',
    contentHash: 'local-content-v5',
    arena: {
      width: 38,
      height: 24,
    },
    player: {
      radius: 0.48,
      speed: 8.2,
      damping: 9,
      maxHp: 100,
      respawnTicks: 90,
    },
    obstacles: [
      { id: 'mid-left', x: -6.5, y: 0, halfWidth: 1.1, halfHeight: 4.1 },
      { id: 'mid-right', x: 6.5, y: 0, halfWidth: 1.1, halfHeight: 4.1 },
      { id: 'top-box', x: 0, y: -6.2, halfWidth: 3.8, halfHeight: 0.85 },
      { id: 'bottom-box', x: 0, y: 6.2, halfWidth: 3.8, halfHeight: 0.85 },
    ],
    abilities: [
      {
        id: 'pulse-bolt',
        name: 'Pulse Bolt',
        shape: 'projectile',
        targeting: 'free-aim',
        damage: 26,
        cooldownTicks: 14,
        radius: 0.22,
        range: 22,
        color: '#ffe66d',
        effects: [
          {
            kind: 'knockback',
            force: 1.55,
          },
        ],
        speed: 1.05,
        lifetimeTicks: 34,
      },
      {
        id: 'arc-slash',
        name: 'Arc Slash',
        shape: 'melee',
        targeting: 'aim-assist',
        damage: 34,
        cooldownTicks: 22,
        radius: 1.3,
        range: 1.65,
        color: '#ff6b4a',
        effects: [
          {
            kind: 'slow',
            multiplier: 0.48,
            durationTicks: 42,
          },
        ],
        arcDegrees: 105,
        windupTicks: 2,
        activeTicks: 3,
      },
      {
        id: 'seeker-spark',
        name: 'Seeker Spark',
        shape: 'projectile',
        targeting: 'aim-assist',
        damage: 18,
        cooldownTicks: 18,
        radius: 0.18,
        range: 18,
        color: '#62d2ff',
        effects: [
          {
            kind: 'heal',
            target: 'self',
            amount: 18,
          },
        ],
        speed: 0.82,
        lifetimeTicks: 32,
      },
      {
        id: 'ion-lance',
        name: 'Ion Lance',
        shape: 'projectile',
        targeting: 'free-aim',
        damage: 44,
        cooldownTicks: 38,
        radius: 0.16,
        range: 28,
        color: '#c79bff',
        effects: [
          {
            kind: 'selfDash',
            distance: 2.2,
          },
        ],
        charge: {
          maxTicks: 30,
          moveSpeedMultiplier: 0.55,
          damageMultiplierMin: 0.55,
          damageMultiplierMax: 1.65,
          rangeMultiplierMin: 0.75,
          rangeMultiplierMax: 1.15,
          radiusMultiplierMin: 0.85,
          radiusMultiplierMax: 1.35,
          autoRelease: true,
        },
        speed: 1.35,
        lifetimeTicks: 30,
      },
    ],
    loadout: {
      abilityIds: ['pulse-bolt', 'arc-slash', 'seeker-spark', 'ion-lance'],
    },
  });
}

export function spawnPointForIndex(index: number): { x: number; y: number } {
  const ring = [
    { x: -12, y: 0 },
    { x: 12, y: 0 },
    { x: 0, y: -8 },
    { x: 0, y: 8 },
    { x: -11, y: -7 },
    { x: 11, y: 7 },
  ];
  return ring[index % ring.length] ?? { x: 0, y: 0 };
}
