import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from './defaultRules';
import { parseRulesetJson, stringifyRuleset, validateRuleset } from './rulesValidation';

describe('rulesValidation', () => {
  it('accepts the default preset', () => {
    expect(validateRuleset(createDefaultRuleset()).loadout.abilityIds).toEqual(['pulse-bolt', 'arc-slash', 'seeker-spark', 'ion-lance']);
  });

  it('round-trips exported rules JSON', () => {
    const ruleset = createDefaultRuleset();
    expect(parseRulesetJson(stringifyRuleset(ruleset))).toEqual(ruleset);
  });

  it('validates player movement and aim config', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      player: {
        ...ruleset.player,
        movement: {
          mode: 'tank',
          turnSpeedDegrees: 420,
          reverseMultiplier: 0.4,
        },
        aim: {
          mode: 'facing',
        },
      },
    });

    expect(parsed.player.movement).toEqual({
      mode: 'tank',
      turnSpeedDegrees: 420,
      reverseMultiplier: 0.4,
      platform: {
        gravity: 28,
        jumpVelocity: 11,
        airControl: 0.42,
        maxFallSpeed: 18,
        groundProbeDistance: 0.18,
      },
    });
    expect(parsed.player.aim).toEqual({ mode: 'facing' });
  });

  it('validates platform movement config', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      player: {
        ...ruleset.player,
        movement: {
          ...ruleset.player.movement,
          mode: 'platform',
          platform: {
            gravity: 32,
            jumpVelocity: 13,
            airControl: 0.5,
            maxFallSpeed: 22,
            groundProbeDistance: 0.12,
          },
        },
      },
    });

    expect(parsed.player.movement.mode).toBe('platform');
    expect(parsed.player.movement.platform).toEqual({
      gravity: 32,
      jumpVelocity: 13,
      airControl: 0.5,
      maxFallSpeed: 22,
      groundProbeDistance: 0.12,
    });
  });

  it('validates orthogonal movement mode', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      player: {
        ...ruleset.player,
        movement: {
          ...ruleset.player.movement,
          mode: 'orthogonal',
        },
      },
    });
    expect(parsed.player.movement.mode).toBe('orthogonal');
  });

  it('rejects invalid player movement and aim config', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        player: {
          ...ruleset.player,
          movement: {
            mode: 'drift',
            turnSpeedDegrees: 420,
            reverseMultiplier: 0.4,
          },
        },
      }),
    ).toThrow(/player\.movement\.mode/);
    expect(() =>
      validateRuleset({
        ...ruleset,
        player: {
          ...ruleset.player,
          aim: {
            mode: 'mouseOnly',
          },
        },
      }),
    ).toThrow(/player\.aim\.mode/);

    expect(() =>
      validateRuleset({
        ...ruleset,
        player: {
          ...ruleset.player,
          movement: {
            ...ruleset.player.movement,
            mode: 'platform',
            platform: {
              ...ruleset.player.movement.platform,
              airControl: 1.4,
            },
          },
        },
      }),
    ).toThrow(/player\.movement\.platform\.airControl/);
  });

  it('rejects a missing slotted ability', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        loadout: { abilityIds: ['pulse-bolt', 'missing', 'seeker-spark', 'ion-lance'] },
      }),
    ).toThrow(/loadout\.abilityIds\[1\]/);
  });

  it('rejects a loadout without four slots', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        loadout: {},
      }),
    ).toThrow(/loadout\.abilityIds/);
  });

  it('rejects invalid ability targeting', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        abilities: ruleset.abilities.map((ability, index) => (index === 0 ? { ...ability, targeting: 'nearest' } : ability)),
      }),
    ).toThrow(/ability\.targeting/);
  });

  it('validates charged ability defaults', () => {
    const ruleset = createDefaultRuleset();
    const charged = validateRuleset({
      ...ruleset,
      abilities: ruleset.abilities.map((ability, index) =>
        index === 0
          ? {
              ...ability,
              charge: {
                maxTicks: 24,
                damageMultiplierMin: 0.5,
                damageMultiplierMax: 1.5,
              },
            }
          : ability,
      ),
    }).abilities[0];

    expect(charged.charge).toMatchObject({
      maxTicks: 24,
      moveSpeedMultiplier: 0.55,
      damageMultiplierMin: 0.5,
      damageMultiplierMax: 1.5,
      autoRelease: true,
    });
  });

  it('rejects invalid charged ability multipliers', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        abilities: ruleset.abilities.map((ability, index) =>
          index === 0
            ? {
                ...ability,
                charge: {
                  maxTicks: 24,
                  damageMultiplierMin: 1.5,
                  damageMultiplierMax: 0.5,
                  autoRelease: true,
                },
              }
            : ability,
        ),
      }),
    ).toThrow(/damageMultiplierMax/);
  });

  it('validates ability effects', () => {
    const ruleset = createDefaultRuleset();
    const ability = validateRuleset({
      ...ruleset,
      abilities: ruleset.abilities.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              effects: [
                { kind: 'knockback', force: 1.2 },
                { kind: 'slow', multiplier: 0.5, durationTicks: 30 },
                { kind: 'heal', target: 'self', amount: 12 },
                { kind: 'selfDash', distance: 1.4 },
                { kind: 'applyStatus', target: 'hit', statusId: 'shocked' },
              ],
            }
          : candidate,
      ),
    }).abilities[0];

    expect(ability.effects).toHaveLength(5);
  });

  it('validates projectile world collision and physics effects', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      abilities: ruleset.abilities.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              worldCollision: 'phase',
              effects: [
                {
                  kind: 'spawnBody',
                  target: 'impact',
                  inheritVelocity: 0.3,
                  body: {
                    shape: 'ball',
                    radius: 0.5,
                    mass: 5,
                    friction: 0.6,
                    restitution: 0.2,
                    linearDamping: 1.2,
                    lifetimeTicks: 80,
                    color: '#2fd17c',
                  },
                },
                {
                  kind: 'snare',
                  target: 'hit',
                  anchor: 'body',
                  durationTicks: 60,
                  radius: 2.2,
                  stiffness: 80,
                  damping: 8,
                  color: '#2fd17c',
                  body: {
                    shape: 'ball',
                    radius: 0.45,
                    mass: 4,
                    friction: 0.5,
                    restitution: 0.1,
                    linearDamping: 1,
                    lifetimeTicks: 80,
                    color: '#2fd17c',
                  },
                },
                {
                  kind: 'dragBody',
                  target: 'self',
                  durationTicks: 90,
                  leashLength: 2.6,
                  stiffness: 70,
                  damping: 9,
                  body: {
                    shape: 'ball',
                    radius: 0.7,
                    mass: 16,
                    friction: 0.95,
                    restitution: 0.05,
                    linearDamping: 2,
                    lifetimeTicks: 90,
                    color: '#c79bff',
                  },
                },
              ],
            }
          : candidate,
      ),
    }).abilities[0];

    expect(parsed.shape).toBe('projectile');
    if (parsed.shape === 'projectile') {
      expect(parsed.worldCollision).toBe('phase');
    }
    expect(parsed.effects).toHaveLength(3);
  });

  it('rejects invalid ability effects', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        abilities: ruleset.abilities.map((ability, index) =>
          index === 0
            ? {
                ...ability,
                effects: [{ kind: 'slow', multiplier: 1.4, durationTicks: 30 }],
              }
            : ability,
        ),
      }),
    ).toThrow(/ability\.effect\.multiplier/);
  });

  it('rejects invalid physics ability fields', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        abilities: ruleset.abilities.map((ability, index) => (index === 0 ? { ...ability, worldCollision: 'bounce' } : ability)),
      }),
    ).toThrow(/ability\.worldCollision/);

    expect(() =>
      validateRuleset({
        ...ruleset,
        abilities: ruleset.abilities.map((ability, index) =>
          index === 0
            ? {
                ...ability,
                effects: [
                  {
                    kind: 'spawnBody',
                    target: 'impact',
                    body: {
                      shape: 'ball',
                      radius: 0.5,
                      mass: 0,
                      lifetimeTicks: 80,
                      color: '#2fd17c',
                    },
                  },
                ],
              }
            : ability,
        ),
      }),
    ).toThrow(/ability\.effect\.body\.mass/);

    expect(() =>
      validateRuleset({
        ...ruleset,
        abilities: ruleset.abilities.map((ability, index) =>
          index === 0
            ? {
                ...ability,
                effects: [
                  {
                    kind: 'dragBody',
                    target: 'hit',
                    durationTicks: 90,
                    leashLength: 0.05,
                    stiffness: 70,
                    damping: 9,
                    body: {
                      shape: 'ball',
                      radius: 0.7,
                      mass: 16,
                      lifetimeTicks: 90,
                      color: '#c79bff',
                    },
                  },
                ],
              }
            : ability,
        ),
      }),
    ).toThrow(/ability\.effect\.leashLength/);
  });

  it('validates mechanics statuses, resources, triggers, and references', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      mechanics: {
        statuses: [
          ...ruleset.mechanics.statuses,
          {
            id: 'burning',
            name: 'Burning',
            color: '#ff6b4a',
            durationTicks: 90,
            tags: ['fire'],
            movementMultiplier: 0.82,
            periodic: {
              everyTicks: 15,
              actions: [{ kind: 'dealDamage', target: 'target', amount: 3, color: '#ff6b4a' }],
            },
          },
        ],
        resources: [...ruleset.mechanics.resources, { id: 'energy', name: 'Energy', color: '#62d2ff', max: 100, start: 40, regenPerTick: 0.5 }],
        triggers: [
          ...ruleset.mechanics.triggers,
          {
            id: 'burn-spend',
            event: 'onHit',
            conditions: [
              { kind: 'hasStatus', target: 'target', statusId: 'burning' },
              { kind: 'resourceAtLeast', target: 'source', resourceId: 'energy', amount: 10 },
            ],
            actions: [
              { kind: 'modifyResource', target: 'source', resourceId: 'energy', amount: -10 },
              { kind: 'flashEffect', target: 'target', radius: 1.2, color: '#ff6b4a' },
            ],
          },
        ],
      },
    });

    expect(parsed.mechanics.statuses.find((status) => status.id === 'burning')?.periodic?.actions).toHaveLength(1);
    expect(parsed.mechanics.triggers.find((trigger) => trigger.id === 'burn-spend')?.actions).toHaveLength(2);
  });

  it('validates match teams and relic objectives', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      match: {
        ...ruleset.match,
        scoreLimit: 5,
        teams: [
          ...ruleset.match.teams,
          {
            id: 'specters',
            name: 'Specters',
            color: '#62d2ff',
          },
        ],
      },
      objectives: [
        ...ruleset.objectives,
        {
          id: 'side-relic',
          name: 'Side Relic',
          kind: 'relicPush',
          spawn: { x: 3, y: 0 },
          body: {
            shape: 'ball',
            radius: 0.55,
            mass: 8,
            friction: 0.7,
            restitution: 0.2,
            linearDamping: 1,
            lifetimeTicks: 1_200,
            color: '#62d2ff',
          },
          scoreZones: [
            {
              id: 'specter-goal',
              team: 'specters',
              x: 8,
              y: 0,
              radius: 2,
              points: 2,
            },
          ],
          scoreCooldownTicks: 24,
          resetOnScore: true,
        },
      ],
    });

    expect(parsed.match.scoreLimit).toBe(5);
    const sideRelic = parsed.objectives.find((objective) => objective.id === 'side-relic');
    expect(sideRelic?.kind === 'relicPush' ? sideRelic.scoreZones[0]?.team : undefined).toBe('specters');
  });

  it('rejects invalid match objective references', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        objectives: ruleset.objectives.map((objective, index) =>
          index === 0 && objective.kind === 'relicPush'
            ? {
                ...objective,
                scoreZones: objective.scoreZones.map((zone, zoneIndex) => (zoneIndex === 0 ? { ...zone, team: 'missing-team' } : zone)),
              }
            : objective,
        ),
      }),
    ).toThrow(/objective\.scoreZone\.team/);

    expect(() =>
      validateRuleset({
        ...ruleset,
        mechanics: {
          ...ruleset.mechanics,
          triggers: [
            {
              id: 'bad-objective-trigger',
              event: 'onScore',
              conditions: [{ kind: 'objectiveId', objectiveId: 'missing-objective' }],
              actions: [{ kind: 'flashEffect', target: 'source', radius: 1, color: '#ffffff' }],
            },
          ],
        },
      }),
    ).toThrow(/unknown objective/);
  });

  it('validates NPC archetypes, spawns, teams, behavior, and loadouts', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      npcs: {
        archetypes: [
          ...ruleset.npcs.archetypes,
          {
            id: 'arc-kiter',
            name: 'Arc Kiter',
            hue: 188,
            team: 'hostile',
            hpMultiplier: 1.2,
            speedMultiplier: 0.8,
            loadout: { abilityIds: ['pulse-bolt', 'arc-slash'] },
            behavior: {
              mode: 'kite',
              aggroRange: 20,
              preferredRange: 8,
              wanderRadius: 4,
            },
            casting: {
              slots: [0, 1],
              minRange: 1,
              maxRange: 18,
            },
          },
        ],
        labSpawns: [...ruleset.npcs.labSpawns, { id: 'arc-kiter-a', archetypeId: 'arc-kiter', x: 3, y: -4, team: 'hostile' }],
        sessionSpawns: [{ id: 'arc-kiter-live', archetypeId: 'arc-kiter', x: 5, y: 0 }],
      },
    });

    expect(parsed.npcs.archetypes.find((archetype) => archetype.id === 'arc-kiter')?.behavior.mode).toBe('kite');
    expect(parsed.npcs.sessionSpawns).toHaveLength(1);
  });

  it('rejects invalid NPC references and behavior config', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        npcs: {
          ...ruleset.npcs,
          archetypes: ruleset.npcs.archetypes.map((archetype, index) =>
            index === 0 ? { ...archetype, loadout: { abilityIds: ['missing-ability'] } } : archetype,
          ),
        },
      }),
    ).toThrow(/must reference an ability/);

    expect(() =>
      validateRuleset({
        ...ruleset,
        npcs: {
          ...ruleset.npcs,
          labSpawns: [{ id: 'bad-spawn', archetypeId: 'missing-npc', x: 0, y: 0 }],
        },
      }),
    ).toThrow(/must reference an NPC archetype/);

    expect(() =>
      validateRuleset({
        ...ruleset,
        npcs: {
          ...ruleset.npcs,
          archetypes: ruleset.npcs.archetypes.map((archetype, index) =>
            index === 0
              ? {
                  ...archetype,
                  behavior: {
                    ...archetype.behavior,
                    mode: 'flank',
                  },
                }
              : archetype,
          ),
        },
      }),
    ).toThrow(/behavior\.mode/);
  });

  it('rejects invalid mechanics references', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        mechanics: {
          ...ruleset.mechanics,
          triggers: [
            {
              id: 'bad-trigger',
              event: 'onHit',
              conditions: [{ kind: 'hasStatus', target: 'target', statusId: 'missing-status' }],
              actions: [{ kind: 'flashEffect', target: 'target', radius: 1, color: '#ffffff' }],
            },
          ],
        },
      }),
    ).toThrow(/unknown status/);
  });

  it('accepts deathmatch objectives with kill scoring', () => {
    const ruleset = createDefaultRuleset();
    const parsed = validateRuleset({
      ...ruleset,
      objectives: [
        {
          id: 'center-relic',
          name: 'Kills',
          kind: 'deathmatch',
          pointsPerKill: 1,
          selfKillPenalty: 1,
          friendlyFirePenalty: 0,
        },
      ],
    });
    const dm = parsed.objectives[0];
    expect(dm?.kind).toBe('deathmatch');
    expect(dm?.kind === 'deathmatch' ? dm.pointsPerKill : 0).toBe(1);
  });

  it('rejects deathmatch objectives with invalid pointsPerKill', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        objectives: [
          {
            id: 'center-relic',
            name: 'Kills',
            kind: 'deathmatch',
            pointsPerKill: -1,
          },
        ],
      }),
    ).toThrow(/pointsPerKill/);
  });

  it('rejects unknown objective kinds with a helpful message', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        objectives: [
          {
            id: 'center-relic',
            name: 'Wat',
            kind: 'survival',
          },
        ],
      }),
    ).toThrow(/relicPush, deathmatch, or kingZone/);
  });

  it('accepts kingZone objectives with a valid zone and contest rule', () => {
    const ruleset = createDefaultRuleset();
    const result = validateRuleset({
      ...ruleset,
      objectives: [
        {
          id: 'center-relic',
          name: 'Throne',
          kind: 'kingZone',
          pointsPerSecond: 1,
          contestRule: 'soloOnly',
          zones: [{ id: 'throne', x: 0, y: 0, radius: 6 }],
        },
      ],
    });
    const kz = result.objectives[0];
    expect(kz?.kind).toBe('kingZone');
    expect(kz?.kind === 'kingZone' ? kz.zones.length : 0).toBe(1);
  });

  it('rejects kingZone objectives with no zones', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        objectives: [
          {
            id: 'center-relic',
            name: 'Throne',
            kind: 'kingZone',
            pointsPerSecond: 1,
            contestRule: 'soloOnly',
            zones: [],
          },
        ],
      }),
    ).toThrow(/objective\.zones/);
  });

  it('rejects kingZone objectives with an unknown contest rule', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        objectives: [
          {
            id: 'center-relic',
            name: 'Throne',
            kind: 'kingZone',
            pointsPerSecond: 1,
            contestRule: 'roulette',
            zones: [{ id: 'throne', x: 0, y: 0, radius: 6 }],
          },
        ],
      }),
    ).toThrow(/contestRule/);
  });
});
