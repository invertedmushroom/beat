import type { Ruleset } from './protocol';
import { validateRuleset } from './rulesValidation';

export function createDefaultRuleset(): Ruleset {
  return validateRuleset({
    id: 'beat-arena-v1',
    name: 'Beat Arena Skills V1',
    version: 1,
    tickRate: 30,
    maxPlayers: 6,
    mapBundleId: 'local-grid-arena',
    contentHash: 'local-content-v2',
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
        damage: 26,
        cooldownTicks: 14,
        radius: 0.22,
        range: 22,
        color: '#ffe66d',
        speed: 1.05,
        lifetimeTicks: 34,
      },
      {
        id: 'arc-slash',
        name: 'Arc Slash',
        shape: 'melee',
        damage: 34,
        cooldownTicks: 22,
        radius: 1.3,
        range: 1.65,
        color: '#ff6b4a',
        arcDegrees: 105,
        windupTicks: 2,
        activeTicks: 3,
      },
    ],
    loadout: {
      primaryAbilityId: 'pulse-bolt',
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
