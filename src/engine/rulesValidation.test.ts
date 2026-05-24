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
});
