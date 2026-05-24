import { describe, expect, it } from 'vitest';
import { chargeRatio, scaleAbilityForCharge } from './charge';
import { createDefaultRuleset } from './defaultRules';

describe('charge helpers', () => {
  it('clamps charge ratio', () => {
    expect(chargeRatio(-4, 20)).toBe(0);
    expect(chargeRatio(10, 20)).toBe(0.5);
    expect(chargeRatio(30, 20)).toBe(1);
  });

  it('scales authored charge fields', () => {
    const ability = createDefaultRuleset().abilities.find((candidate) => candidate.id === 'ion-lance');
    if (!ability?.charge) {
      throw new Error('charged default ability missing');
    }
    const scaled = scaleAbilityForCharge(ability, 1);

    expect(scaled.damage).toBeCloseTo(ability.damage * ability.charge.damageMultiplierMax);
    expect(scaled.range).toBeCloseTo(ability.range * (ability.charge.rangeMultiplierMax ?? 1));
    expect(scaled.radius).toBeCloseTo(ability.radius * (ability.charge.radiusMultiplierMax ?? 1));
  });
});
