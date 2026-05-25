import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../../engine/defaultRules';
import { validateRuleset } from '../../engine/rulesValidation';
import { applyWorkbenchFieldEdit, diagnosticsFromError, workbenchFieldPath } from './fields';
import { createWorkbenchState } from './state';

describe('workbench field registry', () => {
  it('applies scalar rules edits through typed paths', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset);

    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'rules', fieldId: 'movementMode', value: 'platform' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'rules', fieldId: 'platform.airControl', value: '0.55' })).toBe(true);

    const parsed = validateRuleset(ruleset);
    expect(parsed.player.movement.mode).toBe('platform');
    expect(parsed.player.aim.mode).toBe('free');
    expect(parsed.player.movement.platform.airControl).toBe(0.55);
  });

  it('applies selected ability, loadout, trigger, npc, and physics edits', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset, {
      selectedAbilityId: 'pulse-bolt',
      selectedTriggerId: 'shock-bonus',
      selectedNpcId: 'spark-chaser',
    });

    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'ability', fieldId: 'damage', value: '17' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'loadout', slot: 1, value: 'anchor-orb' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'trigger', fieldId: 'firstActionAmount', value: '8' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'npc', fieldId: 'sessionSpawn', value: '', checked: true })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'physics', fieldId: 'anchorMass', value: '4.5' })).toBe(true);

    const parsed = validateRuleset(ruleset);
    expect(parsed.abilities.find((ability) => ability.id === 'pulse-bolt')?.damage).toBe(17);
    expect(parsed.loadout.abilityIds[1]).toBe('anchor-orb');
    expect(parsed.mechanics.triggers.find((trigger) => trigger.id === 'shock-bonus')?.actions[0]).toMatchObject({ amount: 8 });
    expect(parsed.npcs.sessionSpawns.some((spawn) => spawn.archetypeId === 'spark-chaser')).toBe(true);
    expect(
      parsed.abilities
        .find((ability) => ability.id === 'anchor-orb')
        ?.effects?.find((effect) => effect.kind === 'spawnBody'),
    ).toMatchObject({ body: { mass: 4.5 } });
  });

  it('reports paths for edits and common validation failures', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset, { selectedAbilityId: 'pulse-bolt' });

    expect(workbenchFieldPath({ kind: 'ability', fieldId: 'damage', value: '12' }, state)).toBe('abilities[pulse-bolt].damage');
    expect(diagnosticsFromError(new Error('player.movement.platform.airControl must be a finite number between 0 and 1'))).toEqual([
      {
        path: 'player.movement.platform.airControl',
        severity: 'error',
        message: 'player.movement.platform.airControl must be a finite number between 0 and 1',
      },
    ]);
  });
});
