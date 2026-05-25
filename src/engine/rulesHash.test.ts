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
          platform: {
            groundProbeDistance: a.player.movement.platform.groundProbeDistance,
            maxFallSpeed: a.player.movement.platform.maxFallSpeed,
            airControl: a.player.movement.platform.airControl,
            jumpVelocity: a.player.movement.platform.jumpVelocity,
            gravity: a.player.movement.platform.gravity,
          },
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

  it('changes when mechanics tuning changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      mechanics: {
        ...a.mechanics,
        statuses: a.mechanics.statuses.map((status) => (status.id === 'chilled' ? { ...status, durationTicks: status.durationTicks + 1 } : status)),
      },
    };

    expect(rulesetFingerprint(a)).not.toBe(rulesetFingerprint(b));
  });

  it('changes when NPC config changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      npcs: {
        ...a.npcs,
        archetypes: a.npcs.archetypes.map((archetype) =>
          archetype.id === 'spark-chaser' ? { ...archetype, behavior: { ...archetype.behavior, aggroRange: archetype.behavior.aggroRange + 1 } } : archetype,
        ),
      },
    };

    expect(rulesetFingerprint(a)).not.toBe(rulesetFingerprint(b));
  });

  it('changes when objective config changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      objectives: a.objectives.map((objective) =>
        objective.id === 'center-relic'
          ? {
              ...objective,
              scoreZones: objective.scoreZones.map((zone) => (zone.id === 'players-goal' ? { ...zone, radius: zone.radius + 0.25 } : zone)),
            }
          : objective,
      ),
    };

    expect(rulesetFingerprint(a)).not.toBe(rulesetFingerprint(b));
  });

  it('changes when physics ability config changes', () => {
    const a = createDefaultRuleset();
    const b = {
      ...a,
      abilities: a.abilities.map((ability) =>
        ability.id === 'anchor-orb'
          ? {
              ...ability,
              effects: ability.effects?.map((effect) =>
                effect.kind === 'spawnBody'
                  ? {
                      ...effect,
                      body: {
                        ...effect.body,
                        mass: effect.body.mass + 1,
                      },
                    }
                  : effect,
              ),
            }
          : ability,
      ),
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
