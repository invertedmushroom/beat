import type { Ruleset } from './protocol';
import { validateRuleset } from './rulesValidation';

export function createDefaultRuleset(): Ruleset {
  return validateRuleset({
    id: 'beat-arena-v6',
    name: 'Beat Arena Mechanics V6',
    version: 6,
    tickRate: 30,
    maxPlayers: 6,
    mapBundleId: 'local-grid-arena',
    contentHash: 'local-content-v7',
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
      movement: {
        mode: 'twinStick',
        turnSpeedDegrees: 300,
        reverseMultiplier: 0.65,
      },
      aim: {
        mode: 'free',
      },
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
        tags: ['electric'],
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
          {
            kind: 'applyStatus',
            target: 'hit',
            statusId: 'shocked',
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
        tags: ['frost', 'melee'],
        damage: 34,
        cooldownTicks: 22,
        radius: 1.3,
        range: 1.65,
        color: '#ff6b4a',
        effects: [
          {
            kind: 'applyStatus',
            target: 'hit',
            statusId: 'chilled',
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
        tags: ['support'],
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
        tags: ['overcharge'],
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
    mechanics: {
      statuses: [
        {
          id: 'shocked',
          name: 'Shocked',
          color: '#ffe66d',
          durationTicks: 72,
          tags: ['electric'],
        },
        {
          id: 'chilled',
          name: 'Chilled',
          color: '#62d2ff',
          durationTicks: 78,
          tags: ['frost'],
          stacking: 'stack',
          maxStacks: 2,
          movementMultiplier: 0.68,
        },
        {
          id: 'overheated',
          name: 'Overheated',
          color: '#ff6b4a',
          durationTicks: 90,
          tags: ['heat'],
          movementMultiplier: 0.86,
          damageDealtMultiplier: 1.12,
        },
      ],
      resources: [
        {
          id: 'shield',
          name: 'Shield',
          color: '#2fd17c',
          max: 36,
          start: 18,
          regenPerTick: 0.08,
        },
        {
          id: 'heat',
          name: 'Heat',
          color: '#ff6b4a',
          max: 100,
          start: 0,
          regenPerTick: -0.18,
        },
      ],
      triggers: [
        {
          id: 'shock-bonus',
          name: 'Shock Bonus',
          event: 'onHit',
          conditions: [
            { kind: 'abilityTag', tag: 'electric' },
            { kind: 'hasStatus', target: 'target', statusId: 'shocked' },
          ],
          actions: [
            { kind: 'dealDamage', target: 'target', amount: 9, color: '#ffe66d' },
            { kind: 'flashEffect', target: 'target', radius: 1.25, color: '#ffe66d' },
          ],
        },
        {
          id: 'chill-shatter',
          name: 'Chill Shatter',
          event: 'onHit',
          conditions: [
            { kind: 'abilityTag', tag: 'frost' },
            { kind: 'hasStatus', target: 'target', statusId: 'chilled' },
          ],
          actions: [
            { kind: 'dealDamage', target: 'target', amount: 7, color: '#62d2ff' },
            { kind: 'flashEffect', target: 'target', radius: 1.45, color: '#62d2ff' },
          ],
        },
        {
          id: 'spark-shield',
          name: 'Spark Shield',
          event: 'onCast',
          conditions: [{ kind: 'abilityTag', tag: 'support' }],
          actions: [
            { kind: 'modifyResource', target: 'source', resourceId: 'shield', amount: 12 },
            { kind: 'flashEffect', target: 'source', radius: 1.5, color: '#2fd17c' },
          ],
        },
        {
          id: 'shield-cushion',
          name: 'Shield Cushion',
          event: 'onDamageTaken',
          conditions: [{ kind: 'resourceAtLeast', target: 'target', resourceId: 'shield', amount: 10 }],
          actions: [
            { kind: 'modifyResource', target: 'target', resourceId: 'shield', amount: -10 },
            { kind: 'heal', target: 'target', amount: 8 },
            { kind: 'flashEffect', target: 'target', radius: 1.25, color: '#2fd17c' },
          ],
        },
        {
          id: 'lance-heat',
          name: 'Lance Heat',
          event: 'onCast',
          conditions: [{ kind: 'abilityTag', tag: 'overcharge' }],
          actions: [
            { kind: 'modifyResource', target: 'source', resourceId: 'heat', amount: 26 },
            { kind: 'applyStatus', target: 'source', statusId: 'overheated', durationTicks: 72 },
            { kind: 'flashEffect', target: 'source', radius: 1.75, color: '#ff6b4a' },
          ],
        },
        {
          id: 'heated-lance-pop',
          name: 'Heated Lance Pop',
          event: 'onHit',
          conditions: [
            { kind: 'abilityTag', tag: 'overcharge' },
            { kind: 'resourceAtLeast', target: 'source', resourceId: 'heat', amount: 40 },
          ],
          actions: [
            { kind: 'modifyResource', target: 'source', resourceId: 'heat', amount: -30 },
            { kind: 'dealDamage', target: 'target', amount: 12, color: '#ff6b4a' },
            { kind: 'flashEffect', target: 'target', radius: 1.7, color: '#ff6b4a' },
          ],
        },
      ],
    },
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
