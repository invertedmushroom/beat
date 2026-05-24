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
    });
    expect(parsed.player.aim).toEqual({ mode: 'facing' });
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
});
