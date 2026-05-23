import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from './defaultRules';
import { rulesetFingerprint } from './rulesHash';

describe('rulesetFingerprint', () => {
  it('is stable for equivalent object key ordering', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      arena: { height: a.arena.height, width: a.arena.width },
      player: {
        speed: a.player.speed,
        radius: a.player.radius,
        respawnTicks: a.player.respawnTicks,
        maxHp: a.player.maxHp,
        damping: a.player.damping,
      },
    };

    expect(rulesetFingerprint(a)).toBe(rulesetFingerprint(b));
  });

  it('changes when ability tuning changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      abilities: a.abilities.map((ability) => (ability.id === a.loadout.primaryAbilityId ? { ...ability, damage: ability.damage + 1 } : ability)),
    };

    expect(rulesetFingerprint(a)).not.toBe(rulesetFingerprint(b));
  });
});
