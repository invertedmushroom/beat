import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../../engine/defaultRules';
import { validateRuleset } from '../../engine/rulesValidation';
import {
  applyWorkbenchCommand,
  applyWorkbenchFieldEdit,
  diagnosticsFromError,
  workbenchFieldPath,
  workbenchFieldsForSection,
} from './fields';
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

  it('marks tank and platform controls as conditional player fields', () => {
    const playerFields = workbenchFieldsForSection('player');

    expect(playerFields.find((field) => field.id === 'tankTurn')?.visibleWhen).toEqual({ fieldId: 'movementMode', equals: 'tank' });
    expect(playerFields.find((field) => field.id === 'platform.gravity')?.visibleWhen).toEqual({ fieldId: 'movementMode', equals: 'platform' });
  });

  it('applies selected ability, loadout, npc, and ability effect edits', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset, {
      selectedAbilityId: 'anchor-orb',
      selectedNpcId: 'spark-chaser',
    });

    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'ability', fieldId: 'damage', value: '17' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'loadout', slot: 1, value: 'anchor-orb' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'npc', fieldId: 'sessionSpawn', value: '', checked: true })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'abilityEffect', effectIndex: 0, fieldId: 'body.mass', value: '4.5' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'abilityEffect', effectIndex: 1, fieldId: 'stiffness', value: '180' })).toBe(true);

    state.selectedAbilityId = 'wrecking-weight';
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'abilityEffect', effectIndex: 0, fieldId: 'leashLength', value: '3.25' })).toBe(true);

    const parsed = validateRuleset(ruleset);
    expect(parsed.abilities.find((ability) => ability.id === 'anchor-orb')?.damage).toBe(17);
    expect(parsed.loadout.abilityIds[1]).toBe('anchor-orb');
    expect(parsed.npcs.sessionSpawns.some((spawn) => spawn.archetypeId === 'spark-chaser')).toBe(true);
    expect(
      parsed.abilities
        .find((ability) => ability.id === 'anchor-orb')
        ?.effects?.find((effect) => effect.kind === 'spawnBody'),
    ).toMatchObject({ body: { mass: 4.5 } });
    expect(
      parsed.abilities
        .find((ability) => ability.id === 'anchor-orb')
        ?.effects?.find((effect) => effect.kind === 'snare'),
    ).toMatchObject({ stiffness: 180 });
    expect(
      parsed.abilities
        .find((ability) => ability.id === 'wrecking-weight')
        ?.effects?.find((effect) => effect.kind === 'dragBody'),
    ).toMatchObject({ leashLength: 3.25 });
  });

  it('applies mechanics condition and action row edits', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset, { selectedTriggerId: 'shock-bonus' });

    expect(applyWorkbenchCommand(ruleset, state, { kind: 'mechanicCondition', command: 'add' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'mechanicConditionKind', conditionIndex: 2, value: 'hpBelow' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'mechanicCondition', conditionIndex: 2, fieldId: 'target', value: 'target' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'mechanicCondition', conditionIndex: 2, fieldId: 'ratio', value: '0.42' })).toBe(true);

    expect(applyWorkbenchCommand(ruleset, state, { kind: 'mechanicAction', command: 'add' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'mechanicActionKind', actionIndex: 2, value: 'heal' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'mechanicAction', actionIndex: 2, fieldId: 'target', value: 'source' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'mechanicAction', actionIndex: 2, fieldId: 'amount', value: '6' })).toBe(true);
    expect(applyWorkbenchCommand(ruleset, state, { kind: 'mechanicAction', command: 'moveUp', actionIndex: 2 })).toBe(true);

    const trigger = validateRuleset(ruleset).mechanics.triggers.find((candidate) => candidate.id === 'shock-bonus');
    expect(trigger?.conditions?.[2]).toMatchObject({ kind: 'hpBelow', target: 'target', ratio: 0.42 });
    expect(trigger?.actions[1]).toMatchObject({ kind: 'heal', target: 'source', amount: 6 });
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
