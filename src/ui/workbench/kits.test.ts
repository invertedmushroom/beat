import { describe, expect, it } from 'vitest';
import { createDefaultRuleset, spawnPointForIndex } from '../../engine/defaultRules';
import { isArenaPositionBlocked } from '../../engine/playerMovement';
import { rulesetFingerprint } from '../../engine/rulesHash';
import { validateRuleset } from '../../engine/rulesValidation';
import { ABILITY_CARDS, MATCH_KITS, MOVEMENT_CHASSIS, MUTATOR_CHIPS, compileKit, createKitSelection, withMovementPackage } from './kits';

describe('match kits', () => {
  it('applies a movement package to custom rules without rebuilding the rest of the game', () => {
    const current = createDefaultRuleset();
    current.name = 'My custom game';
    current.abilities[0].damage = 97;
    current.player.maxHp = 80;
    const before = structuredClone(current);
    const next = withMovementPackage(current, 'tank');
    expect(next.player).toMatchObject({ speed: 6.8, damping: 8, maxHp: 80, movement: { mode: 'tank' }, aim: { mode: 'facing' } });
    expect({ ...next, player: current.player }).toEqual(current);
    expect(current).toEqual(before);
    expect(() => withMovementPackage(current, 'unknown' as never)).toThrow();
  });
  it('compiles every chassis, card, and chip combination into independent valid rules', () => {
    const defaultBefore = rulesetFingerprint(createDefaultRuleset());
    for (const match of MATCH_KITS) for (const chassis of MOVEMENT_CHASSIS) for (const card of ABILITY_CARDS) {
      const selection = createKitSelection(match.id);
      selection.chassis = chassis.id;
      selection.abilities[0] = card.id;
      selection.mutators = MUTATOR_CHIPS.map((chip) => chip.id);
      const rules = compileKit(selection);
      expect(validateRuleset(rules)).toEqual(rules);
      expect(rules.loadout.abilityIds).toHaveLength(4);
      expect(rules.player.movement.mode).toBe(chassis.mode);
      expect(rules.player.aim.mode).toBe(chassis.aim);
      expect(rules.mechanics.triggers).toEqual([]);
      expect(rules.npcs.sessionSpawns).toEqual([]);
      for (let i = 0; i < rules.maxPlayers; i++) {
        expect(isArenaPositionBlocked(spawnPointForIndex(i), rules.player.radius, rules)).toBe(false);
      }
      rules.abilities[0].damage = 999;
      expect(compileKit(selection).abilities[0].damage).not.toBe(999);
    }
    expect(rulesetFingerprint(createDefaultRuleset())).toBe(defaultBefore);
  });

  it('keeps objectives, capacities, and winning scores tied to their match', () => {
    expect(compileKit(createKitSelection('duel'))).toMatchObject({ maxPlayers: 2, match: { scoreLimit: 5 }, objectives: [{ kind: 'deathmatch' }] });
    expect(compileKit(createKitSelection('hill'))).toMatchObject({ maxPlayers: 6, match: { scoreLimit: 30, friendlyFire: false }, objectives: [{ kind: 'kingZone' }] });
    expect(compileKit(createKitSelection('relic'))).toMatchObject({ match: { scoreLimit: 3, friendlyFire: false }, objectives: [{ kind: 'relicPush', resetOnScore: true }] });
  });

  it('rebuilds multipliers once, independent of toggle order or duplicate chip IDs', () => {
    const selection = createKitSelection('duel');
    const base = compileKit(selection);
    selection.mutators = ['pinball', 'turbo', 'giant', 'turbo'];
    const first = compileKit(selection);
    selection.mutators = ['giant', 'turbo', 'pinball'];
    expect(compileKit(selection)).toEqual(first);
    const bolt = first.abilities[0];
    expect(bolt.cooldownTicks).toBe(6);
    expect(bolt.radius).toBeCloseTo(base.abilities[0].radius * 1.5);
    expect(bolt.effects?.find((effect) => effect.kind === 'knockback')).toMatchObject({ force: 1.55 * 2.5 });
    expect(first.abilities[1].radius).toBe(base.abilities[1].radius);
    selection.mutators = [];
    expect(compileKit(selection)).toEqual(base);
  });

  it('changes only ball tuning for the bouncy sports variant', () => {
    const selection = createKitSelection('relic');
    const regular = compileKit(selection);
    selection.bouncyRelic = true;
    const sports = compileKit(selection);
    expect(sports.objectives[0]).toMatchObject({ kind: 'relicPush', body: { mass: 6, restitution: 0.92, linearDamping: 0.15 } });
    expect(sports.player).toEqual(regular.player);
    expect(sports.abilities).toEqual(regular.abilities);
    expect(sports.objectives[0]).toMatchObject({ scoreZones: regular.objectives[0].kind === 'relicPush' ? regular.objectives[0].scoreZones : [] });
  });

  it('rejects unknown catalog choices and a sports option on another mode', () => {
    const selection = createKitSelection('duel');
    expect(() => compileKit({ ...selection, bouncyRelic: true })).toThrow();
    expect(() => compileKit({ ...selection, chassis: 'missing' } as never)).toThrow();
    expect(() => compileKit({ ...selection, abilities: ['missing'] } as never)).toThrow();
    expect(() => compileKit({ ...selection, mutators: ['missing'] } as never)).toThrow();
  });
});
