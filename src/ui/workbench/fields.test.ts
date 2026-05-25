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
import { matchGameTypeLabel } from './sections';
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

  it('infers game type labels from objectives', () => {
    const ruleset = createDefaultRuleset();
    expect(matchGameTypeLabel(ruleset)).toBe('Relic Push');

    const empty = structuredClone(ruleset);
    empty.objectives = [];
    expect(matchGameTypeLabel(empty)).toBe('No objective scoring');

    const custom = structuredClone(ruleset);
    custom.objectives.push({ ...custom.objectives[0], id: 'side-relic', name: 'Side Relic' });
    expect(matchGameTypeLabel(custom)).toBe('Custom Relic Push');
  });

  it('applies team, objective, and score zone edits', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset, {
      selectedTeamId: 'players',
      selectedObjectiveId: 'center-relic',
      selectedScoreZoneId: 'players-goal',
    });

    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'team', fieldId: 'name', value: 'Green Team' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'team', fieldId: 'color', value: '#33cc88' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'objective', fieldId: 'spawn.x', value: '1.5' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'objective', fieldId: 'body.mass', value: '14' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'objective', fieldId: 'scoreCooldownTicks', value: '12' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'objective', fieldId: 'resetOnScore', value: '', checked: false })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'scoreZone', fieldId: 'radius', value: '3.1' })).toBe(true);
    expect(applyWorkbenchFieldEdit(ruleset, state, { kind: 'scoreZone', fieldId: 'points', value: '2' })).toBe(true);

    const parsed = validateRuleset(ruleset);
    expect(parsed.match.teams[0]).toMatchObject({ name: 'Green Team', color: '#33cc88' });
    expect(parsed.objectives[0]).toMatchObject({ spawn: { x: 1.5 }, body: { mass: 14 }, scoreCooldownTicks: 12, resetOnScore: false });
    expect(parsed.objectives[0]?.scoreZones[0]).toMatchObject({ radius: 3.1, points: 2 });
  });

  it('adds, duplicates, and removes score zones without invalidating relic objectives', () => {
    const ruleset = createDefaultRuleset();
    const state = createWorkbenchState(ruleset, {
      selectedObjectiveId: 'center-relic',
      selectedScoreZoneId: 'players-goal',
    });

    expect(applyWorkbenchCommand(ruleset, state, { kind: 'scoreZone', command: 'add' })).toBe(true);
    expect(ruleset.objectives[0]?.scoreZones).toHaveLength(3);
    expect(state.selectedScoreZoneId).toBeTruthy();
    expect(applyWorkbenchCommand(ruleset, state, { kind: 'scoreZone', command: 'duplicate' })).toBe(true);
    expect(ruleset.objectives[0]?.scoreZones).toHaveLength(4);
    expect(applyWorkbenchCommand(ruleset, state, { kind: 'scoreZone', command: 'remove' })).toBe(true);
    expect(validateRuleset(ruleset).objectives[0]?.scoreZones.length).toBe(3);
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
