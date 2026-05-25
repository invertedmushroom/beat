import type { Ruleset } from '../../engine/protocol';
import type { WorkbenchState, WorkbenchTab } from './state';

export type WorkbenchFieldKind = 'rules' | 'ability' | 'trigger' | 'npc' | 'physics';
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
  | { kind: 'trigger'; fieldId: string; value: string }
  | { kind: 'npc'; fieldId: string; value: string; checked?: boolean }
  | { kind: 'physics'; fieldId: string; value: string };

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
    id: 'firstActionAmount',
    label: 'First action amount',
    section: 'mechanics',
    kind: 'trigger',
    path: 'mechanics.triggers[selected].actions[*].amount',
    controlId: 'workbench-trigger-amount',
    input: 'number',
    step: 1,
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
  {
    id: 'anchorMass',
    label: 'Anchor Orb body mass',
    section: 'physics',
    kind: 'physics',
    path: 'abilities[anchor-orb].effects[spawnBody].body.mass',
    controlId: 'workbench-anchor-mass',
    input: 'number',
    min: 0.1,
    step: 0.5,
  },
  {
    id: 'anchorLifetime',
    label: 'Anchor Orb lifetime',
    section: 'physics',
    kind: 'physics',
    path: 'abilities[anchor-orb].effects[spawnBody].body.lifetimeTicks',
    controlId: 'workbench-anchor-lifetime',
    input: 'number',
    min: 1,
    step: 1,
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
  const field = workbenchField(edit.kind, edit.fieldId);
  if (!field) {
    return '$';
  }
  return field.path
    .replace('abilities[selected]', `abilities[${state.selectedAbilityId || 'selected'}]`)
    .replace('mechanics.triggers[selected]', `mechanics.triggers[${state.selectedTriggerId || 'selected'}]`)
    .replace('npcs.archetypes[selected]', `npcs.archetypes[${state.selectedNpcId || 'selected'}]`);
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
  const triggerField = target.dataset.triggerField;
  if (triggerField) {
    return { kind: 'trigger', fieldId: triggerField, value: target.value };
  }
  const npcField = target.dataset.npcField;
  if (npcField) {
    return { kind: 'npc', fieldId: npcField, value: target.value, checked: target instanceof HTMLInputElement ? target.checked : undefined };
  }
  const physicsField = target.dataset.physicsField;
  if (physicsField) {
    return { kind: 'physics', fieldId: physicsField, value: target.value };
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
  if (edit.kind === 'trigger') {
    return applyTriggerField(ruleset, state, edit);
  }
  if (edit.kind === 'npc') {
    return applyNpcField(ruleset, state, edit);
  }
  return applyPhysicsField(ruleset, edit);
}

export function diagnosticsFromError(error: unknown): WorkbenchDiagnostic[] {
  const message = error instanceof Error ? error.message : String(error);
  return [{ path: inferDiagnosticPath(message), severity: 'error', message }];
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
  const ability = ruleset.abilities.find((candidate) => candidate.id === state.selectedAbilityId) ?? ruleset.abilities[0];
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

function applyTriggerField(ruleset: Ruleset, state: WorkbenchState, edit: Extract<WorkbenchFieldEdit, { kind: 'trigger' }>): boolean {
  const trigger = ruleset.mechanics.triggers.find((candidate) => candidate.id === state.selectedTriggerId) ?? ruleset.mechanics.triggers[0];
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
  if (edit.fieldId === 'firstActionAmount') {
    const value = readNumber(edit.value);
    if (value === undefined) {
      return false;
    }
    const action = trigger.actions.find((candidate) => 'amount' in candidate);
    if (action && 'amount' in action) {
      action.amount = value;
    }
    return true;
  }
  return false;
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

function applyPhysicsField(ruleset: Ruleset, edit: Extract<WorkbenchFieldEdit, { kind: 'physics' }>): boolean {
  const value = readNumber(edit.value);
  if (value === undefined) {
    return false;
  }
  const anchorOrb = ruleset.abilities.find((ability) => ability.id === 'anchor-orb');
  const bodyEffect = anchorOrb?.effects?.find((effect) => effect.kind === 'spawnBody');
  if (!bodyEffect || bodyEffect.kind !== 'spawnBody') {
    return false;
  }
  if (edit.fieldId === 'anchorMass') {
    bodyEffect.body.mass = value;
  } else if (edit.fieldId === 'anchorLifetime') {
    bodyEffect.body.lifetimeTicks = Math.round(value);
  } else {
    return false;
  }
  return true;
}

function readNumber(value: string): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
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
  return path;
}
