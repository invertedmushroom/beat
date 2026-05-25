import type { AbilityEffect, MechanicAction, MechanicCondition, PhysicsBodySpec, Ruleset } from '../../engine/protocol';
import type { WorkbenchState, WorkbenchTab } from './state';

export type WorkbenchFieldKind = 'rules' | 'ability' | 'trigger' | 'npc';
export type WorkbenchFieldInput = 'text' | 'number' | 'checkbox' | 'select' | 'color';

export type WorkbenchField = {
  id: string;
  label: string;
  section: WorkbenchTab;
  kind: WorkbenchFieldKind;
  path: string;
  controlId: string;
  input: WorkbenchFieldInput;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  visibleWhen?: { fieldId: 'movementMode'; equals: Ruleset['player']['movement']['mode'] };
};

export type WorkbenchDiagnostic = {
  path: string;
  severity: 'error' | 'warning';
  message: string;
};

export type WorkbenchFieldEdit =
  | { kind: 'rules'; fieldId: string; value: string; checked?: boolean }
  | { kind: 'loadout'; slot: number; value: string }
  | { kind: 'ability'; fieldId: string; value: string }
  | { kind: 'abilityEffect'; effectIndex: number; fieldId: string; value: string }
  | { kind: 'abilityEffectKind'; effectIndex: number; value: string }
  | { kind: 'trigger'; fieldId: string; value: string }
  | { kind: 'mechanicCondition'; conditionIndex: number; fieldId: string; value: string }
  | { kind: 'mechanicConditionKind'; conditionIndex: number; value: string }
  | { kind: 'mechanicAction'; actionIndex: number; fieldId: string; value: string }
  | { kind: 'mechanicActionKind'; actionIndex: number; value: string }
  | { kind: 'npc'; fieldId: string; value: string; checked?: boolean };

export type WorkbenchCommand =
  | { kind: 'abilityEffect'; command: 'add' | 'remove' | 'moveUp' | 'moveDown'; effectIndex?: number; effectKind?: AbilityEffect['kind'] }
  | { kind: 'mechanicCondition'; command: 'add' | 'remove' | 'moveUp' | 'moveDown'; conditionIndex?: number }
  | { kind: 'mechanicAction'; command: 'add' | 'remove' | 'moveUp' | 'moveDown'; actionIndex?: number };

export const WORKBENCH_FIELDS: WorkbenchField[] = [
  { id: 'name', label: 'Name', section: 'match', kind: 'rules', path: 'name', controlId: 'workbench-rule-name', input: 'text', maxLength: 48 },
  {
    id: 'durationSeconds',
    label: 'Duration seconds',
    section: 'match',
    kind: 'rules',
    path: 'match.durationTicks',
    controlId: 'workbench-duration',
    input: 'number',
    min: 1,
    step: 1,
  },
  {
    id: 'scoreLimit',
    label: 'Score limit',
    section: 'match',
    kind: 'rules',
    path: 'match.scoreLimit',
    controlId: 'workbench-score-limit',
    input: 'number',
    min: 1,
    step: 1,
  },
  {
    id: 'friendlyFire',
    label: 'Friendly fire',
    section: 'match',
    kind: 'rules',
    path: 'match.friendlyFire',
    controlId: 'workbench-friendly-fire',
    input: 'checkbox',
  },
  {
    id: 'objectiveRadius',
    label: 'First zone radius',
    section: 'match',
    kind: 'rules',
    path: 'objectives[0].scoreZones[0].radius',
    controlId: 'workbench-objective-radius',
    input: 'number',
    min: 0.1,
    step: 0.05,
  },
  {
    id: 'objectivePoints',
    label: 'First zone points',
    section: 'match',
    kind: 'rules',
    path: 'objectives[0].scoreZones[0].points',
    controlId: 'workbench-objective-points',
    input: 'number',
    min: 1,
    step: 1,
  },
  {
    id: 'movementMode',
    label: 'Movement mode',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.mode',
    controlId: 'workbench-movement-mode',
    input: 'select',
    options: [
      { value: 'twinStick', label: 'Twin stick' },
      { value: 'tank', label: 'Tank' },
      { value: 'platform', label: 'Platform' },
    ],
  },
  {
    id: 'aimMode',
    label: 'Aim mode',
    section: 'player',
    kind: 'rules',
    path: 'player.aim.mode',
    controlId: 'workbench-aim-mode',
    input: 'select',
    options: [
      { value: 'free', label: 'Free' },
      { value: 'facing', label: 'Facing' },
    ],
  },
  {
    id: 'playerSpeed',
    label: 'Speed',
    section: 'player',
    kind: 'rules',
    path: 'player.speed',
    controlId: 'workbench-player-speed',
    input: 'number',
    min: 1,
    step: 0.1,
  },
  {
    id: 'playerDamping',
    label: 'Damping',
    section: 'player',
    kind: 'rules',
    path: 'player.damping',
    controlId: 'workbench-player-damping',
    input: 'number',
    min: 0,
    step: 0.1,
  },
  {
    id: 'playerMaxHp',
    label: 'Max HP',
    section: 'player',
    kind: 'rules',
    path: 'player.maxHp',
    controlId: 'workbench-player-hp',
    input: 'number',
    min: 1,
    step: 1,
  },
  {
    id: 'tankTurn',
    label: 'Tank turn deg/s',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.turnSpeedDegrees',
    controlId: 'workbench-tank-turn',
    input: 'number',
    min: 30,
    step: 10,
    visibleWhen: { fieldId: 'movementMode', equals: 'tank' },
  },
  {
    id: 'tankReverse',
    label: 'Tank reverse',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.reverseMultiplier',
    controlId: 'workbench-tank-reverse',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    visibleWhen: { fieldId: 'movementMode', equals: 'tank' },
  },
  {
    id: 'platform.gravity',
    label: 'Gravity',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.platform.gravity',
    controlId: 'workbench-platform-gravity',
    input: 'number',
    min: 1,
    step: 1,
    visibleWhen: { fieldId: 'movementMode', equals: 'platform' },
  },
  {
    id: 'platform.jumpVelocity',
    label: 'Jump velocity',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.platform.jumpVelocity',
    controlId: 'workbench-platform-jump',
    input: 'number',
    min: 1,
    step: 0.5,
    visibleWhen: { fieldId: 'movementMode', equals: 'platform' },
  },
  {
    id: 'platform.airControl',
    label: 'Air control',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.platform.airControl',
    controlId: 'workbench-platform-air',
    input: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    visibleWhen: { fieldId: 'movementMode', equals: 'platform' },
  },
  {
    id: 'platform.maxFallSpeed',
    label: 'Max fall speed',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.platform.maxFallSpeed',
    controlId: 'workbench-platform-fall',
    input: 'number',
    min: 1,
    step: 1,
    visibleWhen: { fieldId: 'movementMode', equals: 'platform' },
  },
  {
    id: 'platform.groundProbeDistance',
    label: 'Ground probe',
    section: 'player',
    kind: 'rules',
    path: 'player.movement.platform.groundProbeDistance',
    controlId: 'workbench-platform-probe',
    input: 'number',
    min: 0.01,
    step: 0.01,
    visibleWhen: { fieldId: 'movementMode', equals: 'platform' },
  },
  {
    id: 'targeting',
    label: 'Targeting',
    section: 'abilities',
    kind: 'ability',
    path: 'abilities[selected].targeting',
    controlId: 'workbench-ability-targeting',
    input: 'select',
    options: [
      { value: 'free-aim', label: 'Free aim' },
      { value: 'aim-assist', label: 'Aim assist' },
    ],
  },
  {
    id: 'damage',
    label: 'Damage',
    section: 'abilities',
    kind: 'ability',
    path: 'abilities[selected].damage',
    controlId: 'workbench-ability-damage',
    input: 'number',
    min: 0,
    step: 1,
  },
  {
    id: 'cooldownTicks',
    label: 'Cooldown ticks',
    section: 'abilities',
    kind: 'ability',
    path: 'abilities[selected].cooldownTicks',
    controlId: 'workbench-ability-cooldown',
    input: 'number',
    min: 0,
    step: 1,
  },
  {
    id: 'range',
    label: 'Range',
    section: 'abilities',
    kind: 'ability',
    path: 'abilities[selected].range',
    controlId: 'workbench-ability-range',
    input: 'number',
    min: 0.1,
    step: 0.1,
  },
  {
    id: 'radius',
    label: 'Radius',
    section: 'abilities',
    kind: 'ability',
    path: 'abilities[selected].radius',
    controlId: 'workbench-ability-radius',
    input: 'number',
    min: 0.05,
    step: 0.05,
  },
  {
    id: 'color',
    label: 'Color',
    section: 'abilities',
    kind: 'ability',
    path: 'abilities[selected].color',
    controlId: 'workbench-ability-color',
    input: 'color',
  },
  {
    id: 'name',
    label: 'Trigger name',
    section: 'mechanics',
    kind: 'trigger',
    path: 'mechanics.triggers[selected].name',
    controlId: 'workbench-trigger-name',
    input: 'text',
    maxLength: 48,
  },
  {
    id: 'event',
    label: 'Event',
    section: 'mechanics',
    kind: 'trigger',
    path: 'mechanics.triggers[selected].event',
    controlId: 'workbench-trigger-event',
    input: 'select',
    options: [
      { value: 'onCast', label: 'onCast' },
      { value: 'onHit', label: 'onHit' },
      { value: 'onDamageTaken', label: 'onDamageTaken' },
      { value: 'onStatusApplied', label: 'onStatusApplied' },
      { value: 'onStatusExpired', label: 'onStatusExpired' },
      { value: 'onKill', label: 'onKill' },
      { value: 'onLowHp', label: 'onLowHp' },
      { value: 'onObjectiveEnter', label: 'onObjectiveEnter' },
      { value: 'onObjectiveTick', label: 'onObjectiveTick' },
      { value: 'onScore', label: 'onScore' },
    ],
  },
  {
    id: 'behavior',
    label: 'Behavior',
    section: 'npcs',
    kind: 'npc',
    path: 'npcs.archetypes[selected].behavior.mode',
    controlId: 'workbench-npc-behavior',
    input: 'select',
    options: [
      { value: 'idle', label: 'Idle' },
      { value: 'wander', label: 'Wander' },
      { value: 'seek', label: 'Seek' },
      { value: 'kite', label: 'Kite' },
    ],
  },
  {
    id: 'aggroRange',
    label: 'Aggro range',
    section: 'npcs',
    kind: 'npc',
    path: 'npcs.archetypes[selected].behavior.aggroRange',
    controlId: 'workbench-npc-aggro',
    input: 'number',
    min: 0,
    step: 0.5,
  },
  {
    id: 'speedMultiplier',
    label: 'Speed multiplier',
    section: 'npcs',
    kind: 'npc',
    path: 'npcs.archetypes[selected].speedMultiplier',
    controlId: 'workbench-npc-speed',
    input: 'number',
    min: 0,
    step: 0.05,
  },
  {
    id: 'sessionSpawn',
    label: 'Spawn in Solo/Host',
    section: 'npcs',
    kind: 'npc',
    path: 'npcs.sessionSpawns',
    controlId: 'workbench-npc-session',
    input: 'checkbox',
  },
];

const FIELDS_BY_KIND = new Map<string, WorkbenchField>(
  WORKBENCH_FIELDS.map((field) => [`${field.kind}:${field.id}`, field]),
);

export function workbenchFieldsForSection(section: WorkbenchTab, kind?: WorkbenchFieldKind): WorkbenchField[] {
  return WORKBENCH_FIELDS.filter((field) => field.section === section && (!kind || field.kind === kind));
}

export function workbenchField(kind: WorkbenchFieldKind, fieldId: string): WorkbenchField | undefined {
  return FIELDS_BY_KIND.get(`${kind}:${fieldId}`);
}

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
  const field = workbenchField(edit.kind, edit.fieldId);
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
  return `mechanics.triggers[${state.selectedTriggerId || 'selected'}].actions`;
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
  return applyNpcField(ruleset, state, edit);
}

export function applyWorkbenchCommand(ruleset: Ruleset, state: WorkbenchState, command: WorkbenchCommand): boolean {
  if (command.kind === 'abilityEffect') {
    return applyAbilityEffectCommand(ruleset, state, command);
  }
  if (command.kind === 'mechanicCondition') {
    return applyMechanicConditionCommand(ruleset, state, command);
  }
  return applyMechanicActionCommand(ruleset, state, command);
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
  if (edit.fieldId === 'objectiveRadius') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    const zone = ruleset.objectives[0]?.scoreZones[0];
    if (zone) {
      zone.radius = value;
    }
    return true;
  }
  if (edit.fieldId === 'objectivePoints') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    const zone = ruleset.objectives[0]?.scoreZones[0];
    if (zone) {
      zone.points = Math.round(value);
    }
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
  return path;
}
