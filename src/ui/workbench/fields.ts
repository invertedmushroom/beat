import type { AbilityEffect, MechanicAction, MechanicCondition, PhysicsBodySpec, RelicPushObjective, Ruleset } from '../../engine/protocol';
import type { WorkbenchState } from './state';
import { workbenchField as lookupWorkbenchField } from './fields/registry';
import type { WorkbenchCommand, WorkbenchDiagnostic, WorkbenchFieldEdit } from './fieldTypes';

export type {
  WorkbenchCommand,
  WorkbenchDiagnostic,
  WorkbenchField,
  WorkbenchFieldEdit,
  WorkbenchFieldInput,
  WorkbenchFieldKind,
} from './fieldTypes';

export { WORKBENCH_FIELDS, workbenchField, workbenchFieldsForSection } from './fields/registry';

export function workbenchFieldPath(edit: WorkbenchFieldEdit, state: WorkbenchState): string {
  if (edit.kind === 'loadout') {
    return `loadout.abilityIds[${edit.slot}]`;
  }
  if (edit.kind === 'abilityEffect') {
    return `abilities[${state.selectedAbilityId || 'selected'}].effects[${edit.effectIndex}].${edit.fieldId}`;
  }
  if (edit.kind === 'abilityEffectKind') {
    return `abilities[${state.selectedAbilityId || 'selected'}].effects[${edit.effectIndex}].kind`;
  }
  if (edit.kind === 'mechanicCondition') {
    return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].conditions[${edit.conditionIndex}].${edit.fieldId}`;
  }
  if (edit.kind === 'mechanicConditionKind') {
    return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].conditions[${edit.conditionIndex}].kind`;
  }
  if (edit.kind === 'mechanicAction') {
    return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].actions[${edit.actionIndex}].${edit.fieldId}`;
  }
  if (edit.kind === 'mechanicActionKind') {
    return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].actions[${edit.actionIndex}].kind`;
  }
  if (edit.kind === 'team') {
    return `match.teams[${state.selectedTeamId || 'selected'}].${edit.fieldId}`;
  }
  if (edit.kind === 'objective') {
    return `objectives[${state.selectedObjectiveId || 'selected'}].${edit.fieldId}`;
  }
  if (edit.kind === 'scoreZone') {
    return `objectives[${state.selectedObjectiveId || 'selected'}].scoreZones[${state.selectedScoreZoneId || 'selected'}].${edit.fieldId}`;
  }
  const field = lookupWorkbenchField(edit.kind, edit.fieldId);
  if (!field) {
    return '$';
  }
  return field.path
    .replace('abilities[selected]', `abilities[${state.selectedAbilityId || 'selected'}]`)
    .replace('mechanics.triggers[selected]', `mechanics.triggers[${state.selectedTriggerId || 'selected'}]`)
    .replace('npcs.archetypes[selected]', `npcs.archetypes[${state.selectedNpcId || 'selected'}]`);
}

export function workbenchCommandPath(command: WorkbenchCommand, state: WorkbenchState): string {
  if (command.kind === 'abilityEffect') {
    return `abilities[${state.selectedAbilityId || 'selected'}].effects`;
  }
  if (command.kind === 'mechanicCondition') {
    return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].conditions`;
  }
  if (command.kind === 'mechanicAction') {
    return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].actions`;
  }
  return `objectives[${state.selectedObjectiveId || 'selected'}].scoreZones`;
}

export function workbenchEditFromControl(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): WorkbenchFieldEdit | undefined {
  const rulesField = target.dataset.rulesField;
  if (rulesField) {
    return { kind: 'rules', fieldId: rulesField, value: target.value, checked: target instanceof HTMLInputElement ? target.checked : undefined };
  }
  if (target.dataset.loadoutSlot !== undefined) {
    const slot = Number(target.dataset.loadoutSlot);
    return Number.isInteger(slot) ? { kind: 'loadout', slot, value: target.value } : undefined;
  }
  const abilityField = target.dataset.abilityField;
  if (abilityField) {
    return { kind: 'ability', fieldId: abilityField, value: target.value };
  }
  const effectIndex = readIndex(target.dataset.effectIndex);
  if (effectIndex !== undefined) {
    if (target.dataset.effectKind === 'true') {
      return { kind: 'abilityEffectKind', effectIndex, value: target.value };
    }
    const effectField = target.dataset.effectField;
    if (effectField) {
      return { kind: 'abilityEffect', effectIndex, fieldId: effectField, value: target.value };
    }
  }
  const triggerField = target.dataset.triggerField;
  if (triggerField) {
    return { kind: 'trigger', fieldId: triggerField, value: target.value };
  }
  const teamField = target.dataset.teamField;
  if (teamField) {
    return { kind: 'team', fieldId: teamField, value: target.value };
  }
  const objectiveField = target.dataset.objectiveField;
  if (objectiveField) {
    return { kind: 'objective', fieldId: objectiveField, value: target.value, checked: target instanceof HTMLInputElement ? target.checked : undefined };
  }
  const scoreZoneField = target.dataset.scoreZoneField;
  if (scoreZoneField) {
    return { kind: 'scoreZone', fieldId: scoreZoneField, value: target.value };
  }
  const conditionIndex = readIndex(target.dataset.conditionIndex);
  if (conditionIndex !== undefined) {
    if (target.dataset.conditionKind === 'true') {
      return { kind: 'mechanicConditionKind', conditionIndex, value: target.value };
    }
    const conditionField = target.dataset.conditionField;
    if (conditionField) {
      return { kind: 'mechanicCondition', conditionIndex, fieldId: conditionField, value: target.value };
    }
  }
  const actionIndex = readIndex(target.dataset.actionIndex);
  if (actionIndex !== undefined) {
    if (target.dataset.actionKind === 'true') {
      return { kind: 'mechanicActionKind', actionIndex, value: target.value };
    }
    const actionField = target.dataset.actionField;
    if (actionField) {
      return { kind: 'mechanicAction', actionIndex, fieldId: actionField, value: target.value };
    }
  }
  const npcField = target.dataset.npcField;
  if (npcField) {
    return { kind: 'npc', fieldId: npcField, value: target.value, checked: target instanceof HTMLInputElement ? target.checked : undefined };
  }
  return undefined;
}

export function workbenchCommandFromButton(button: HTMLButtonElement): WorkbenchCommand | undefined {
  const effectCommand = button.dataset.effectCommand;
  if (effectCommand === 'add' || effectCommand === 'remove' || effectCommand === 'moveUp' || effectCommand === 'moveDown') {
    return {
      kind: 'abilityEffect',
      command: effectCommand,
      effectIndex: readIndex(button.dataset.effectIndex),
      effectKind: isAbilityEffectKind(button.dataset.effectKindValue) ? button.dataset.effectKindValue : undefined,
    };
  }
  const conditionCommand = button.dataset.conditionCommand;
  if (conditionCommand === 'add' || conditionCommand === 'remove' || conditionCommand === 'moveUp' || conditionCommand === 'moveDown') {
    return {
      kind: 'mechanicCondition',
      command: conditionCommand,
      conditionIndex: readIndex(button.dataset.conditionIndex),
    };
  }
  const actionCommand = button.dataset.actionCommand;
  if (actionCommand === 'add' || actionCommand === 'remove' || actionCommand === 'moveUp' || actionCommand === 'moveDown') {
    return {
      kind: 'mechanicAction',
      command: actionCommand,
      actionIndex: readIndex(button.dataset.actionIndex),
    };
  }
  const scoreZoneCommand = button.dataset.scoreZoneCommand;
  if (scoreZoneCommand === 'add' || scoreZoneCommand === 'duplicate' || scoreZoneCommand === 'remove') {
    return {
      kind: 'scoreZone',
      command: scoreZoneCommand,
      scoreZoneId: button.dataset.scoreZoneId,
    };
  }
  return undefined;
}

export function applyWorkbenchFieldEdit(ruleset: Ruleset, state: WorkbenchState, edit: WorkbenchFieldEdit): boolean {
  if (edit.kind === 'rules') {
    return applyRulesField(ruleset, edit);
  }
  if (edit.kind === 'loadout') {
    if (edit.slot < 0 || edit.slot >= ruleset.loadout.abilityIds.length) {
      return false;
    }
    ruleset.loadout.abilityIds[edit.slot] = edit.value;
    return true;
  }
  if (edit.kind === 'ability') {
    return applyAbilityField(ruleset, state, edit);
  }
  if (edit.kind === 'abilityEffect' || edit.kind === 'abilityEffectKind') {
    return applyAbilityEffectEdit(ruleset, state, edit);
  }
  if (edit.kind === 'trigger') {
    return applyTriggerField(ruleset, state, edit);
  }
  if (edit.kind === 'mechanicCondition' || edit.kind === 'mechanicConditionKind') {
    return applyMechanicConditionEdit(ruleset, state, edit);
  }
  if (edit.kind === 'mechanicAction' || edit.kind === 'mechanicActionKind') {
    return applyMechanicActionEdit(ruleset, state, edit);
  }
  if (edit.kind === 'npc') {
    return applyNpcField(ruleset, state, edit);
  }
  if (edit.kind === 'team') {
    return applyTeamField(ruleset, state, edit);
  }
  if (edit.kind === 'objective') {
    return applyObjectiveField(ruleset, state, edit);
  }
  return applyScoreZoneField(ruleset, state, edit);
}

export function applyWorkbenchCommand(ruleset: Ruleset, state: WorkbenchState, command: WorkbenchCommand): boolean {
  if (command.kind === 'abilityEffect') {
    return applyAbilityEffectCommand(ruleset, state, command);
  }
  if (command.kind === 'mechanicCondition') {
    return applyMechanicConditionCommand(ruleset, state, command);
  }
  if (command.kind === 'mechanicAction') {
    return applyMechanicActionCommand(ruleset, state, command);
  }
  return applyScoreZoneCommand(ruleset, state, command);
}

export function diagnosticsFromError(error: unknown): WorkbenchDiagnostic[] {
  const message = error instanceof Error ? error.message : String(error);
  return [{ path: inferDiagnosticPath(message), severity: 'error', message }];
}

export function defaultAbilityEffect(kind: AbilityEffect['kind'], ruleset: Ruleset, color = '#ffffff'): AbilityEffect {
  if (kind === 'knockback') {
    return { kind, force: 2 };
  }
  if (kind === 'slow') {
    return { kind, multiplier: 0.65, durationTicks: 60 };
  }
  if (kind === 'heal') {
    return { kind, target: 'self', amount: 10 };
  }
  if (kind === 'selfDash') {
    return { kind, distance: 2 };
  }
  if (kind === 'applyStatus') {
    return { kind, target: 'hit', statusId: firstStatusId(ruleset), durationTicks: 90 };
  }
  if (kind === 'spawnBody') {
    return { kind, target: 'impact', inheritVelocity: 0, body: defaultPhysicsBody(color) };
  }
  if (kind === 'snare') {
    return { kind, target: 'hit', anchor: 'impact', durationTicks: 90, radius: 2, stiffness: 120, damping: 12, color };
  }
  return { kind, target: 'self', durationTicks: 120, leashLength: 2.5, stiffness: 80, damping: 10, color, body: defaultPhysicsBody(color) };
}

export function defaultMechanicCondition(kind: MechanicCondition['kind'], ruleset: Ruleset): MechanicCondition {
  if (kind === 'hasStatus' || kind === 'missingStatus') {
    return { kind, target: 'target', statusId: firstStatusId(ruleset) };
  }
  if (kind === 'hpBelow') {
    return { kind, target: 'target', ratio: 0.3 };
  }
  if (kind === 'resourceAtLeast') {
    return { kind, target: 'source', resourceId: firstResourceId(ruleset), amount: 1 };
  }
  if (kind === 'slotUsed') {
    return { kind, slot: 0 };
  }
  if (kind === 'abilityTag') {
    return { kind, tag: firstAbilityTag(ruleset) };
  }
  if (kind === 'objectiveId') {
    return { kind, objectiveId: firstObjectiveId(ruleset) };
  }
  return { kind, teamId: firstTeamId(ruleset) };
}

export function defaultMechanicAction(kind: MechanicAction['kind'], ruleset: Ruleset): MechanicAction {
  if (kind === 'applyStatus') {
    return { kind, target: 'target', statusId: firstStatusId(ruleset), durationTicks: 90 };
  }
  if (kind === 'removeStatus') {
    return { kind, target: 'target', statusId: firstStatusId(ruleset) };
  }
  if (kind === 'dealDamage') {
    return { kind, target: 'target', amount: 8, color: '#ffffff' };
  }
  if (kind === 'heal') {
    return { kind, target: 'source', amount: 8 };
  }
  if (kind === 'knockback') {
    return { kind, target: 'target', force: 2, direction: 'sourceToTarget', color: '#ffffff' };
  }
  if (kind === 'slow') {
    return { kind, target: 'target', multiplier: 0.7, durationTicks: 60, color: '#7aa8ff' };
  }
  if (kind === 'modifyResource') {
    return { kind, target: 'source', resourceId: firstResourceId(ruleset), amount: 5 };
  }
  return { kind, target: 'source', radius: 1.5, color: '#ffffff' };
}

function applyRulesField(ruleset: Ruleset, edit: Extract<WorkbenchFieldEdit, { kind: 'rules' }>): boolean {
  if (edit.fieldId === 'name') {
    ruleset.name = edit.value;
    return true;
  }
  if (edit.fieldId === 'durationSeconds') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    ruleset.match.durationTicks = Math.round(value * ruleset.tickRate);
    return true;
  }
  if (edit.fieldId === 'scoreLimit') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    ruleset.match.scoreLimit = Math.round(value);
    return true;
  }
  if (edit.fieldId === 'friendlyFire') {
    ruleset.match.friendlyFire = Boolean(edit.checked);
    return true;
  }
  if (edit.fieldId === 'movementMode') {
    ruleset.player.movement.mode = edit.value as Ruleset['player']['movement']['mode'];
    if (edit.value === 'platform') {
      ruleset.player.damping = Math.min(ruleset.player.damping, 0.6);
      ruleset.player.aim.mode = 'free';
    }
    return true;
  }
  if (edit.fieldId === 'aimMode') {
    ruleset.player.aim.mode = edit.value as Ruleset['player']['aim']['mode'];
    return true;
  }
  if (edit.fieldId === 'playerSpeed' || edit.fieldId === 'playerDamping' || edit.fieldId === 'playerMaxHp') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    if (edit.fieldId === 'playerSpeed') {
      ruleset.player.speed = value;
    } else if (edit.fieldId === 'playerDamping') {
      ruleset.player.damping = value;
    } else {
      ruleset.player.maxHp = Math.round(value);
    }
    return true;
  }
  if (edit.fieldId === 'tankTurn' || edit.fieldId === 'tankReverse') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    if (edit.fieldId === 'tankTurn') {
      ruleset.player.movement.turnSpeedDegrees = value;
    } else {
      ruleset.player.movement.reverseMultiplier = value;
    }
    return true;
  }
  if (edit.fieldId.startsWith('platform.')) {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    const key = edit.fieldId.slice('platform.'.length) as keyof Ruleset['player']['movement']['platform'];
    ruleset.player.movement.platform[key] = value;
    return true;
  }
  return false;
}

function applyAbilityField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'ability' }>): boolean {
  const ability = selectedAbility(ruleset, state);
  if (!ability) {
    return false;
  }
  if (edit.fieldId === 'targeting') {
    ability.targeting = edit.value as Ruleset['abilities'][number]['targeting'];
    return true;
  }
  if (edit.fieldId === 'color') {
    ability.color = edit.value;
    return true;
  }
  const value = readNumber(edit.value);
  if (value === undefined) {
    return false;
  }
  if (edit.fieldId === 'damage') {
    ability.damage = value;
  } else if (edit.fieldId === 'cooldownTicks') {
    ability.cooldownTicks = Math.round(value);
  } else if (edit.fieldId === 'range') {
    ability.range = value;
  } else if (edit.fieldId === 'radius') {
    ability.radius = value;
  } else {
    return false;
  }
  return true;
}

function applyAbilityEffectEdit(
  ruleset: Ruleset,
  state: WorkbenchState,
  edit: Extract<WorkbenchFieldEdit, { kind: 'abilityEffect' | 'abilityEffectKind' }>,
): boolean {
  const ability = selectedAbility(ruleset, state);
  if (!ability) {
    return false;
  }
  const effects = ability.effects;
  const effect = effects?.[edit.effectIndex];
  if (!effect) {
    return false;
  }
  state.selectedAbilityEffectIndex = edit.effectIndex;
  if (edit.kind === 'abilityEffectKind') {
    if (!isAbilityEffectKind(edit.value)) {
      return false;
    }
    effects[edit.effectIndex] = defaultAbilityEffect(edit.value, ruleset, ability.color);
    return true;
  }
  return applyEffectField(effect, edit.fieldId, edit.value, ruleset, ability.color);
}

function applyAbilityEffectCommand(ruleset: Ruleset, state: WorkbenchState, command: Extract<WorkbenchCommand, { kind: 'abilityEffect' }>): boolean {
  const ability = selectedAbility(ruleset, state);
  if (!ability) {
    return false;
  }
  ability.effects ??= [];
  if (command.command === 'add') {
    ability.effects.push(defaultAbilityEffect(command.effectKind ?? 'knockback', ruleset, ability.color));
    state.selectedAbilityEffectIndex = ability.effects.length - 1;
    return true;
  }
  const index = command.effectIndex;
  if (index === undefined || index < 0 || index >= ability.effects.length) {
    return false;
  }
  state.selectedAbilityEffectIndex = index;
  if (command.command === 'remove') {
    ability.effects.splice(index, 1);
    if (ability.effects.length === 0) {
      delete ability.effects;
    }
    state.selectedAbilityEffectIndex = Math.max(0, index - 1);
    return true;
  }
  return moveItem(ability.effects, index, command.command === 'moveUp' ? index - 1 : index + 1);
}

function applyTriggerField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'trigger' }>): boolean {
  const trigger = selectedTrigger(ruleset, state);
  if (!trigger) {
    return false;
  }
  if (edit.fieldId === 'event') {
    trigger.event = edit.value as Ruleset['mechanics']['triggers'][number]['event'];
    return true;
  }
  if (edit.fieldId === 'name') {
    trigger.name = edit.value;
    return true;
  }
  return false;
}

function applyMechanicConditionEdit(
  ruleset: Ruleset,
  state: WorkbenchState,
  edit: Extract<WorkbenchFieldEdit, { kind: 'mechanicCondition' | 'mechanicConditionKind' }>,
): boolean {
  const trigger = selectedTrigger(ruleset, state);
  const conditions = trigger?.conditions;
  const condition = conditions?.[edit.conditionIndex];
  if (!trigger || !conditions || !condition) {
    return false;
  }
  state.selectedTriggerConditionIndex = edit.conditionIndex;
  if (edit.kind === 'mechanicConditionKind') {
    if (!isMechanicConditionKind(edit.value)) {
      return false;
    }
    conditions[edit.conditionIndex] = defaultMechanicCondition(edit.value, ruleset);
    return true;
  }
  return applyConditionField(condition, edit.fieldId, edit.value);
}

function applyMechanicConditionCommand(
  ruleset: Ruleset,
  state: WorkbenchState,
  command: Extract<WorkbenchCommand, { kind: 'mechanicCondition' }>,
): boolean {
  const trigger = selectedTrigger(ruleset, state);
  if (!trigger) {
    return false;
  }
  if (command.command === 'add') {
    trigger.conditions = [...(trigger.conditions ?? []), defaultMechanicCondition('slotUsed', ruleset)];
    state.selectedTriggerConditionIndex = trigger.conditions.length - 1;
    return true;
  }
  const conditions = trigger.conditions;
  const index = command.conditionIndex;
  if (!conditions || index === undefined || index < 0 || index >= conditions.length) {
    return false;
  }
  state.selectedTriggerConditionIndex = index;
  if (command.command === 'remove') {
    conditions.splice(index, 1);
    if (conditions.length === 0) {
      delete trigger.conditions;
    }
    state.selectedTriggerConditionIndex = Math.max(0, index - 1);
    return true;
  }
  return moveItem(conditions, index, command.command === 'moveUp' ? index - 1 : index + 1);
}

function applyMechanicActionEdit(
  ruleset: Ruleset,
  state: WorkbenchState,
  edit: Extract<WorkbenchFieldEdit, { kind: 'mechanicAction' | 'mechanicActionKind' }>,
): boolean {
  const trigger = selectedTrigger(ruleset, state);
  const action = trigger?.actions[edit.actionIndex];
  if (!trigger || !action) {
    return false;
  }
  state.selectedTriggerActionIndex = edit.actionIndex;
  if (edit.kind === 'mechanicActionKind') {
    if (!isMechanicActionKind(edit.value)) {
      return false;
    }
    trigger.actions[edit.actionIndex] = defaultMechanicAction(edit.value, ruleset);
    return true;
  }
  return applyActionField(action, edit.fieldId, edit.value);
}

function applyMechanicActionCommand(ruleset: Ruleset, state: WorkbenchState, command: Extract<WorkbenchCommand, { kind: 'mechanicAction' }>): boolean {
  const trigger = selectedTrigger(ruleset, state);
  if (!trigger) {
    return false;
  }
  if (command.command === 'add') {
    trigger.actions.push(defaultMechanicAction('flashEffect', ruleset));
    state.selectedTriggerActionIndex = trigger.actions.length - 1;
    return true;
  }
  const index = command.actionIndex;
  if (index === undefined || index < 0 || index >= trigger.actions.length) {
    return false;
  }
  state.selectedTriggerActionIndex = index;
  if (command.command === 'remove') {
    if (trigger.actions.length <= 1) {
      return false;
    }
    trigger.actions.splice(index, 1);
    state.selectedTriggerActionIndex = Math.max(0, index - 1);
    return true;
  }
  return moveItem(trigger.actions, index, command.command === 'moveUp' ? index - 1 : index + 1);
}

function applyNpcField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'npc' }>): boolean {
  const archetype = ruleset.npcs.archetypes.find((candidate) => candidate.id === state.selectedNpcId) ?? ruleset.npcs.archetypes[0];
  if (!archetype) {
    return false;
  }
  if (edit.fieldId === 'behavior') {
    archetype.behavior.mode = edit.value as Ruleset['npcs']['archetypes'][number]['behavior']['mode'];
    return true;
  }
  if (edit.fieldId === 'sessionSpawn') {
    const spawnId = `${archetype.id}-session`;
    ruleset.npcs.sessionSpawns = ruleset.npcs.sessionSpawns.filter((spawn) => spawn.id !== spawnId);
    if (edit.checked) {
      ruleset.npcs.sessionSpawns.push({ id: spawnId, archetypeId: archetype.id, x: 0, y: -4 });
    }
    return true;
  }
  const value = readNumber(edit.value);
  if (value === undefined) {
    return false;
  }
  if (edit.fieldId === 'aggroRange') {
    archetype.behavior.aggroRange = value;
  } else if (edit.fieldId === 'speedMultiplier') {
    archetype.speedMultiplier = value;
  } else {
    return false;
  }
  return true;
}

function applyTeamField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'team' }>): boolean {
  const team = selectedTeam(ruleset, state);
  if (!team) {
    return false;
  }
  state.selectedTeamId = team.id;
  if (edit.fieldId === 'name') {
    team.name = edit.value;
    return true;
  }
  if (edit.fieldId === 'color') {
    team.color = edit.value;
    return true;
  }
  return false;
}

function applyObjectiveField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'objective' }>): boolean {
  const objective = selectedObjective(ruleset, state);
  if (!objective) {
    return false;
  }
  state.selectedObjectiveId = objective.id;
  if (edit.fieldId === 'name') {
    objective.name = edit.value;
    return true;
  }
  if (edit.fieldId === 'resetOnScore') {
    objective.resetOnScore = Boolean(edit.checked);
    return true;
  }
  if (edit.fieldId === 'body.color') {
    objective.body.color = edit.value;
    return true;
  }
  const value = readNumber(edit.value);
  if (value === undefined) {
    return false;
  }
  if (edit.fieldId === 'spawn.x') {
    objective.spawn.x = value;
  } else if (edit.fieldId === 'spawn.y') {
    objective.spawn.y = value;
  } else if (edit.fieldId === 'body.radius') {
    objective.body.radius = value;
  } else if (edit.fieldId === 'body.mass') {
    objective.body.mass = value;
  } else if (edit.fieldId === 'scoreCooldownTicks') {
    objective.scoreCooldownTicks = Math.round(value);
  } else {
    return false;
  }
  return true;
}

function applyScoreZoneField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'scoreZone' }>): boolean {
  const objective = selectedObjective(ruleset, state);
  const zone = objective ? selectedScoreZone(objective, state) : undefined;
  if (!objective || !zone) {
    return false;
  }
  state.selectedObjectiveId = objective.id;
  state.selectedScoreZoneId = zone.id;
  if (edit.fieldId === 'team') {
    zone.team = edit.value;
    return true;
  }
  if (edit.fieldId === 'color') {
    if (edit.value.trim() === '') {
      delete zone.color;
    } else {
      zone.color = edit.value;
    }
    return true;
  }
  const value = readNumber(edit.value);
  if (value === undefined) {
    return false;
  }
  if (edit.fieldId === 'x') {
    zone.x = value;
  } else if (edit.fieldId === 'y') {
    zone.y = value;
  } else if (edit.fieldId === 'radius') {
    zone.radius = value;
  } else if (edit.fieldId === 'points') {
    zone.points = Math.round(value);
  } else {
    return false;
  }
  return true;
}

function applyScoreZoneCommand(ruleset: Ruleset, state: WorkbenchState, command: Extract<WorkbenchCommand, { kind: 'scoreZone' }>): boolean {
  const objective = selectedObjective(ruleset, state);
  if (!objective) {
    return false;
  }
  state.selectedObjectiveId = objective.id;
  if (command.command === 'add') {
    const zone = defaultScoreZone(ruleset, objective);
    objective.scoreZones.push(zone);
    state.selectedScoreZoneId = zone.id;
    return true;
  }
  const selectedId = command.scoreZoneId ?? state.selectedScoreZoneId;
  const index = objective.scoreZones.findIndex((zone) => zone.id === selectedId);
  if (index < 0) {
    return false;
  }
  if (command.command === 'duplicate') {
    const source = objective.scoreZones[index];
    if (!source) {
      return false;
    }
    const duplicate = {
      ...source,
      id: uniqueScoreZoneId(objective, `${source.id}-copy`),
      x: source.x + 1,
    };
    objective.scoreZones.splice(index + 1, 0, duplicate);
    state.selectedScoreZoneId = duplicate.id;
    return true;
  }
  if (objective.scoreZones.length <= 1) {
    return false;
  }
  objective.scoreZones.splice(index, 1);
  state.selectedScoreZoneId = objective.scoreZones[Math.max(0, index - 1)]?.id ?? '';
  return true;
}

function applyEffectField(effect: AbilityEffect, fieldId: string, value: string, ruleset: Ruleset, color: string): boolean {
  const mutable = effect as unknown as Record<string, unknown>;
  if (fieldId === 'body.radius' || fieldId === 'body.mass' || fieldId === 'body.friction' || fieldId === 'body.restitution' || fieldId === 'body.linearDamping') {
    return setBodyNumber(effect, fieldId.slice('body.'.length) as keyof PhysicsBodySpec, value);
  }
  if (fieldId === 'body.lifetimeTicks') {
    return setBodyNumber(effect, 'lifetimeTicks', value, true);
  }
  if (fieldId === 'body.color') {
    const body = ensureEffectBody(effect, color);
    if (!body) {
      return false;
    }
    body.color = value;
    return true;
  }
  if (fieldId === 'target') {
    mutable.target = value;
    return true;
  }
  if (fieldId === 'statusId') {
    mutable.statusId = value || firstStatusId(ruleset);
    return true;
  }
  if (fieldId === 'durationTicks') {
    if (effect.kind === 'applyStatus') {
      return setOptionalNumber(mutable, 'durationTicks', value, true);
    }
    return setNumber(mutable, 'durationTicks', value, true);
  }
  if (fieldId === 'stacks') {
    return setOptionalNumber(mutable, 'stacks', value, true);
  }
  if (fieldId === 'force' || fieldId === 'multiplier' || fieldId === 'amount' || fieldId === 'distance' || fieldId === 'radius' || fieldId === 'stiffness' || fieldId === 'damping' || fieldId === 'leashLength') {
    return setNumber(mutable, fieldId, value);
  }
  if (fieldId === 'inheritVelocity') {
    return setOptionalNumber(mutable, 'inheritVelocity', value);
  }
  if (fieldId === 'anchor' && effect.kind === 'snare') {
    effect.anchor = value as typeof effect.anchor;
    if (effect.anchor === 'body' && !effect.body) {
      effect.body = defaultPhysicsBody(color);
    }
    return true;
  }
  if (fieldId === 'color' && (effect.kind === 'snare' || effect.kind === 'dragBody')) {
    effect.color = value;
    return true;
  }
  return false;
}

function applyConditionField(condition: MechanicCondition, fieldId: string, value: string): boolean {
  const mutable = condition as unknown as Record<string, unknown>;
  if (fieldId === 'target' || fieldId === 'statusId' || fieldId === 'resourceId' || fieldId === 'tag' || fieldId === 'objectiveId' || fieldId === 'teamId') {
    mutable[fieldId] = value;
    return true;
  }
  if (fieldId === 'ratio' || fieldId === 'amount') {
    return setNumber(mutable, fieldId, value);
  }
  if (fieldId === 'slot') {
    return setNumber(mutable, fieldId, value, true);
  }
  return false;
}

function applyActionField(action: MechanicAction, fieldId: string, value: string): boolean {
  const mutable = action as unknown as Record<string, unknown>;
  if (fieldId === 'target' || fieldId === 'statusId' || fieldId === 'resourceId' || fieldId === 'direction') {
    mutable[fieldId] = value;
    return true;
  }
  if (fieldId === 'color') {
    if (value.trim() === '') {
      delete mutable.color;
    } else {
      mutable.color = value;
    }
    return true;
  }
  if (fieldId === 'durationTicks' || fieldId === 'stacks') {
    if (action.kind === 'applyStatus' && fieldId === 'durationTicks') {
      return setOptionalNumber(mutable, fieldId, value, true);
    }
    if (action.kind === 'applyStatus' && fieldId === 'stacks') {
      return setOptionalNumber(mutable, fieldId, value, true);
    }
    return setNumber(mutable, fieldId, value, true);
  }
  if (fieldId === 'amount' || fieldId === 'force' || fieldId === 'multiplier' || fieldId === 'radius') {
    return setNumber(mutable, fieldId, value);
  }
  return false;
}

function selectedAbility(ruleset: Ruleset, state: WorkbenchState): Ruleset['abilities'][number] | undefined {
  return ruleset.abilities.find((candidate) => candidate.id === state.selectedAbilityId) ?? ruleset.abilities[0];
}

function selectedTrigger(ruleset: Ruleset, state: WorkbenchState): Ruleset['mechanics']['triggers'][number] | undefined {
  return ruleset.mechanics.triggers.find((candidate) => candidate.id === state.selectedTriggerId) ?? ruleset.mechanics.triggers[0];
}

function selectedTeam(ruleset: Ruleset, state: WorkbenchState): Ruleset['match']['teams'][number] | undefined {
  return ruleset.match.teams.find((candidate) => candidate.id === state.selectedTeamId) ?? ruleset.match.teams[0];
}

function selectedObjective(ruleset: Ruleset, state: WorkbenchState): RelicPushObjective | undefined {
  const match = ruleset.objectives.find((candidate) => candidate.id === state.selectedObjectiveId)
    ?? ruleset.objectives[0];
  return match && match.kind === 'relicPush' ? match : undefined;
}

function selectedScoreZone(
  objective: RelicPushObjective,
  state: WorkbenchState,
): RelicPushObjective['scoreZones'][number] | undefined {
  return objective.scoreZones.find((candidate) => candidate.id === state.selectedScoreZoneId) ?? objective.scoreZones[0];
}

function defaultScoreZone(ruleset: Ruleset, objective: RelicPushObjective): RelicPushObjective['scoreZones'][number] {
  const usedTeams = new Set(objective.scoreZones.map((zone) => zone.team));
  const team = ruleset.match.teams.find((candidate) => !usedTeams.has(candidate.id)) ?? ruleset.match.teams[0];
  return {
    id: uniqueScoreZoneId(objective, `${team?.id ?? 'team'}-zone`),
    team: team?.id ?? 'players',
    x: 0,
    y: 0,
    radius: 2.45,
    points: 1,
    color: team?.color,
  };
}

function uniqueScoreZoneId(objective: RelicPushObjective, baseId: string): string {
  const base = baseId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'zone';
  const ids = new Set(objective.scoreZones.map((zone) => zone.id));
  if (!ids.has(base)) {
    return base;
  }
  let index = 2;
  while (ids.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function setBodyNumber(effect: AbilityEffect, key: keyof PhysicsBodySpec, value: string, round = false): boolean {
  const body = ensureEffectBody(effect);
  if (!body) {
    return false;
  }
  const number = readNumber(value);
  if (number === undefined) {
    return false;
  }
  (body as unknown as Record<string, unknown>)[key] = round ? Math.round(number) : number;
  return true;
}

function ensureEffectBody(effect: AbilityEffect, color = '#ffffff'): PhysicsBodySpec | undefined {
  if (effect.kind === 'spawnBody' || effect.kind === 'dragBody') {
    return effect.body;
  }
  if (effect.kind === 'snare') {
    effect.body ??= defaultPhysicsBody(color);
    return effect.body;
  }
  return undefined;
}

function defaultPhysicsBody(color = '#ffffff'): PhysicsBodySpec {
  return {
    shape: 'ball',
    radius: 0.55,
    mass: 8,
    friction: 0.75,
    restitution: 0.18,
    linearDamping: 1.2,
    lifetimeTicks: 120,
    color,
  };
}

function setNumber(record: Record<string, unknown>, key: string, value: string, round = false): boolean {
  const number = readNumber(value);
  if (number === undefined) {
    return false;
  }
  record[key] = round ? Math.round(number) : number;
  return true;
}

function setOptionalNumber(record: Record<string, unknown>, key: string, value: string, round = false): boolean {
  if (value.trim() === '') {
    delete record[key];
    return true;
  }
  return setNumber(record, key, value, round);
}

function readNumber(value: string): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function readIndex(value: string | undefined): number | undefined {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

function moveItem<T>(items: T[], from: number, to: number): boolean {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return false;
  }
  const [item] = items.splice(from, 1);
  if (item === undefined) {
    return false;
  }
  items.splice(to, 0, item);
  return true;
}

function isAbilityEffectKind(value: string | undefined): value is AbilityEffect['kind'] {
  return value === 'knockback' || value === 'slow' || value === 'heal' || value === 'selfDash' || value === 'applyStatus' || value === 'spawnBody' || value === 'snare' || value === 'dragBody';
}

function isMechanicConditionKind(value: string | undefined): value is MechanicCondition['kind'] {
  return value === 'hasStatus' || value === 'missingStatus' || value === 'hpBelow' || value === 'resourceAtLeast' || value === 'slotUsed' || value === 'abilityTag' || value === 'objectiveId' || value === 'scoringTeam';
}

function isMechanicActionKind(value: string | undefined): value is MechanicAction['kind'] {
  return value === 'applyStatus' || value === 'removeStatus' || value === 'dealDamage' || value === 'heal' || value === 'knockback' || value === 'slow' || value === 'modifyResource' || value === 'flashEffect';
}

function firstStatusId(ruleset: Ruleset): string {
  return ruleset.mechanics.statuses[0]?.id ?? 'chilled';
}

function firstResourceId(ruleset: Ruleset): string {
  return ruleset.mechanics.resources[0]?.id ?? 'shield';
}

function firstObjectiveId(ruleset: Ruleset): string {
  return ruleset.objectives[0]?.id ?? 'center-relic';
}

function firstTeamId(ruleset: Ruleset): string {
  return ruleset.match.teams[0]?.id ?? 'players';
}

function firstAbilityTag(ruleset: Ruleset): string {
  return ruleset.abilities.flatMap((ability) => ability.tags ?? [])[0] ?? 'support';
}

function inferDiagnosticPath(message: string): string {
  if (/json|unexpected|parse/i.test(message)) {
    return '$';
  }
  const path = message.match(/\b([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+|\[\d+\])*)\b/)?.[1];
  if (!path) {
    return '$';
  }
  if (path === 'mechanics.trigger') {
    return 'mechanics.triggers';
  }
  if (path === 'ability.effect') {
    return 'abilities.effects';
  }
  if (path === 'objective.scoreZone') {
    return 'objectives.scoreZones';
  }
  if (path === 'objective.spawn') {
    return 'objectives.spawn';
  }
  if (path === 'objective.body') {
    return 'objectives.body';
  }
  return path;
}
