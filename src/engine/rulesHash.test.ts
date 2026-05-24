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
        movement: {
          reverseMultiplier: a.player.movement.reverseMultiplier,
          turnSpeedDegrees: a.player.movement.turnSpeedDegrees,
          mode: a.player.movement.mode,
        },
        maxHp: a.player.maxHp,
        damping: a.player.damping,
        aim: {
          mode: a.player.aim.mode,
        },
      },
    };

    expect(rulesetFingerprint(a)).toBe(rulesetFingerprint(b));
  });

  it('changes when ability tuning changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      abilities: a.abilities.map((ability) => (ability.id === a.loadout.abilityIds[0] ? { ...ability, damage: ability.damage + 1 } : ability)),
    };

    expect(rulesetFingerprint(a)).not.toBe(rulesetFingerprint(b));
  });

  it('changes when loadout order changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      loadout: { abilityIds: [a.loadout.abilityIds[1], a.loadout.abilityIds[0], a.loadout.abilityIds[2], a.loadout.abilityIds[3]] },
    };

    expect(rulesetFingerprint(a)).not.toBe(rulesetFingerprint(b));
  });
});
