import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../../engine/defaultRules';
import {
  EXPERIMENTS,
  MECHANIC_PRESETS,
  applyExperiment,
  isCompleteExperimentId,
  isMechanicPresetEnabled,
  toggleMechanicPreset,
} from './experiments';
import {
  MUTATOR_CHIPS,
  compileKit,
  createExperimentSelection,
  createKitSelection,
  withExperimentSelection,
} from './kits';

describe('library experiments', () => {
  it('preserves all complete examples and their mechanics independently of match kits', () => {
    const source = createDefaultRuleset();
    const before = structuredClone(source);
    for (const entry of EXPERIMENTS) {
      const result = applyExperiment(source, entry.id);
      expect(result.mechanics.triggers.length).toBeGreaterThan(0);
      expect(result.abilities).toHaveLength(source.abilities.length);
      result.abilities[0].damage = 999;
    }
    expect(source).toEqual(before);
    const duel = applyExperiment(source, 'duel-preset');
    const kit = compileKit(createKitSelection('duel'));
    expect(duel.maxPlayers).toBe(kit.maxPlayers);
    expect(duel.objectives[0].kind).toBe(kit.objectives[0].kind);
    expect(duel.obstacles).toEqual(source.obstacles);
    expect(duel.obstacles).not.toEqual(kit.obstacles);
    expect(kit.mechanics.triggers).toEqual([]);
    expect(applyExperiment(source, 'platform-preset').obstacles).toHaveLength(11);
    expect(applyExperiment(source, 'physics-preset').loadout.abilityIds[0]).toBe('anchor-orb');
    expect(applyExperiment(source, 'king-zone-preset').objectives[0].kind).toBe('kingZone');
    expect(applyExperiment(source, 'deathmatch-preset').match.scoreLimit).toBe(10);
    expect(() => applyExperiment(source, 'unknown')).toThrow('Choose an experiment');
  });

  it('compiles experiment selections through the unified kit builder with mutators and swaps', () => {
    const source = createDefaultRuleset();
    for (const entry of EXPERIMENTS) {
      if (!isCompleteExperimentId(entry.id)) continue;
      const selection = createExperimentSelection(entry.id);
      expect(compileKit(selection)).toEqual(applyExperiment(source, entry.id));

      selection.mutators = MUTATOR_CHIPS.map((chip) => chip.id);
      selection.chassis = 'tank';
      selection.abilities[0] = 'anchor-orb';
      const customized = compileKit(selection);
      expect(customized.player.movement.mode).toBe('tank');
      expect(customized.loadout.abilityIds[0]).toBe('anchor-orb');
      expect(customized.abilities[0].cooldownTicks).toBe(6);
      expect(customized.mechanics.triggers.length).toBeGreaterThan(0);
    }

    const base = createExperimentSelection('duel-preset');
    const withBleed = withExperimentSelection(base, 'bleed-dot')!;
    expect(withBleed.addons).toEqual(['bleed-dot']);
    expect(compileKit(withBleed).mechanics.statuses.some((status) => status.id === 'bleeding')).toBe(true);
    const toggledOff = withExperimentSelection(withBleed, 'bleed-dot')!;
    expect(toggledOff.addons).toEqual([]);
    expect(compileKit(toggledOff).mechanics.statuses.some((status) => status.id === 'bleeding')).toBe(false);
  });

  it('adds mechanics to edited rules idempotently without changing their arena or loadout', () => {
    const current = compileKit(createKitSelection('duel'));
    current.name = 'My edited duel';
    current.player.speed = 5;
    const bleed = applyExperiment(current, 'bleed-dot');
    expect(applyExperiment(bleed, 'bleed-dot')).toEqual(bleed);
    const execute = applyExperiment(bleed, 'execute');
    expect(applyExperiment(execute, 'execute')).toEqual(execute);
    expect(execute.name).toBe(current.name);
    expect(execute.player).toEqual(current.player);
    expect(execute.obstacles).toEqual(current.obstacles);
    expect(execute.loadout).toEqual(current.loadout);
    expect(execute.mechanics.statuses.some((status) => status.id === 'bleeding')).toBe(true);
    expect(execute.mechanics.triggers.some((trigger) => trigger.id === 'low-hp-execute')).toBe(true);
    expect(current.mechanics.triggers).toEqual([]);
  });

  it('toggles mechanic presets on and off cleanly for any match kit', () => {
    for (const matchId of ['duel', 'hill', 'relic'] as const) {
      const base = compileKit(createKitSelection(matchId));
      for (const preset of MECHANIC_PRESETS) {
        expect(isMechanicPresetEnabled(base, preset.id)).toBe(false);
        const enabled = toggleMechanicPreset(base, preset.id, true);
        expect(isMechanicPresetEnabled(enabled, preset.id)).toBe(true);
        const disabled = toggleMechanicPreset(enabled, preset.id, false);
        expect(isMechanicPresetEnabled(disabled, preset.id)).toBe(false);
        expect(disabled).toEqual(base);
      }
    }
  });
});
