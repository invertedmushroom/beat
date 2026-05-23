import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from './defaultRules';
import { parseRulesetJson, stringifyRuleset, validateRuleset } from './rulesValidation';

describe('rulesValidation', () => {
  it('accepts the default preset', () => {
    expect(validateRuleset(createDefaultRuleset()).loadout.primaryAbilityId).toBe('pulse-bolt');
  });

  it('round-trips exported rules JSON', () => {
    const ruleset = createDefaultRuleset();
    expect(parseRulesetJson(stringifyRuleset(ruleset))).toEqual(ruleset);
  });

  it('rejects a missing primary ability', () => {
    const ruleset = createDefaultRuleset();
    expect(() =>
      validateRuleset({
        ...ruleset,
        loadout: { primaryAbilityId: 'missing' },
      }),
    ).toThrow(/primaryAbilityId/);
  });
});
