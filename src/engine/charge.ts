import type { Ability } from './protocol';

export function chargeRatio(chargeTicks: number, maxTicks: number): number {
  if (maxTicks <= 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, chargeTicks / maxTicks));
}

export function scaleAbilityForCharge<T extends Ability>(ability: T, ratio: number): T {
  const charge = ability.charge;
  if (!charge) {
    return ability;
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  return {
    ...ability,
    damage: ability.damage * lerp(charge.damageMultiplierMin, charge.damageMultiplierMax, clamped),
    range: ability.range * lerp(charge.rangeMultiplierMin ?? 1, charge.rangeMultiplierMax ?? 1, clamped),
    radius: ability.radius * lerp(charge.radiusMultiplierMin ?? 1, charge.radiusMultiplierMax ?? 1, clamped),
  };
}

function lerp(min: number, max: number, ratio: number): number {
  return min + (max - min) * ratio;
}
