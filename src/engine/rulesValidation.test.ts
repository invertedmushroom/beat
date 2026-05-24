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
              ],
            }
          : candidate,
      ),
    }).abilities[0];

    expect(ability.effects).toHaveLength(4);
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
});
