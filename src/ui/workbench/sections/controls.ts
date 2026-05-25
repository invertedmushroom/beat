import type { AbilityEffect, MechanicAction, MechanicCondition, PhysicsBodySpec, Ruleset } from '../../../engine/protocol';
import { escapeHtml } from '../inspector';

export type Option = { value: string; label: string };

export type DynamicFieldSpec = {
  scope: 'effect' | 'condition' | 'action' | 'team' | 'objective' | 'scoreZone';
  index: number;
  fieldId: string;
  label: string;
  path: string;
  input: 'text' | 'number' | 'select' | 'color' | 'checkbox';
  value: string | number | boolean | undefined;
  min?: number;
  max?: number;
  step?: number;
  options?: Option[];
};

export const EFFECT_KIND_OPTIONS: Array<{ value: AbilityEffect['kind']; label: string }> = [
  { value: 'knockback', label: 'Knockback' },
  { value: 'slow', label: 'Slow' },
  { value: 'heal', label: 'Heal' },
  { value: 'selfDash', label: 'Self dash' },
  { value: 'applyStatus', label: 'Apply status' },
  { value: 'spawnBody', label: 'Spawn body' },
  { value: 'snare', label: 'Snare' },
  { value: 'dragBody', label: 'Drag body' },
];

export const CONDITION_KIND_OPTIONS: Array<{ value: MechanicCondition['kind']; label: string }> = [
  { value: 'hasStatus', label: 'Has status' },
  { value: 'missingStatus', label: 'Missing status' },
  { value: 'hpBelow', label: 'HP below' },
  { value: 'resourceAtLeast', label: 'Resource at least' },
  { value: 'slotUsed', label: 'Slot used' },
  { value: 'abilityTag', label: 'Ability tag' },
  { value: 'objectiveId', label: 'Objective' },
  { value: 'scoringTeam', label: 'Scoring team' },
];

export const ACTION_KIND_OPTIONS: Array<{ value: MechanicAction['kind']; label: string }> = [
  { value: 'applyStatus', label: 'Apply status' },
  { value: 'removeStatus', label: 'Remove status' },
  { value: 'dealDamage', label: 'Deal damage' },
  { value: 'heal', label: 'Heal' },
  { value: 'knockback', label: 'Knockback' },
  { value: 'slow', label: 'Slow' },
  { value: 'modifyResource', label: 'Modify resource' },
  { value: 'flashEffect', label: 'Flash effect' },
];

export const MECHANIC_TARGET_OPTIONS: Option[] = [
  { value: 'source', label: 'Source' },
  { value: 'target', label: 'Target' },
];

export function sectionShell(title: string, body: string): string {
  return `
    <section class="workbench-chain__section">
      <h3>${escapeHtml(title)}</h3>
      ${body}
    </section>
  `;
}

export function rowShell(scope: 'effect' | 'condition' | 'action', index: number, title: string, kindControl: string, fields: string, buttons: string): string {
  return `
    <article id="workbench-${scope}-${index}" class="workbench-chain__row">
      <div class="workbench-chain__row-header">
        <strong>${escapeHtml(title)}</strong>
        <div class="workbench-mini-actions">${buttons}</div>
      </div>
      <div class="workbench-grid workbench-grid--chain">
        ${kindControl}
        ${fields}
      </div>
    </article>
  `;
}

export function rowButtonsHtml(scope: 'effect' | 'condition' | 'action', index: number, count: number, canRemove: boolean): string {
  const prefix = commandPrefix(scope);
  return [
    `<button class="button button--mini" type="button" data-${prefix}-command="moveUp" data-${prefix}-index="${index}"${index === 0 ? ' disabled' : ''}>Up</button>`,
    `<button class="button button--mini" type="button" data-${prefix}-command="moveDown" data-${prefix}-index="${index}"${index >= count - 1 ? ' disabled' : ''}>Down</button>`,
    `<button class="button button--mini button--danger" type="button" data-${prefix}-command="remove" data-${prefix}-index="${index}"${canRemove ? '' : ' disabled'}>Remove</button>`,
  ].join('');
}

export function kindSelectHtml<T extends string>(
  scope: 'effect' | 'condition' | 'action',
  index: number,
  path: string,
  options: Array<{ value: T; label: string }>,
  value: T,
): string {
  const prefix = commandPrefix(scope);
  return `<label class="field"><span>Type</span><select id="workbench-${scope}-${index}-kind" data-${prefix}-index="${index}" data-${prefix}-kind="true" data-workbench-path="${escapeHtml(path)}">${optionsHtml(
    options,
    value,
  )}</select></label>`;
}

export function fieldsHtml(fields: DynamicFieldSpec[]): string {
  return fields.map(fieldHtml).join('');
}

export function fieldHtml(field: DynamicFieldSpec): string {
  const prefix = commandPrefix(field.scope);
  const baseAttrs = [
    `id="${escapeHtml(controlId(field.scope, field.index, field.fieldId))}"`,
    `data-${prefix}-index="${field.index}"`,
    `data-${prefix}-field="${escapeHtml(field.fieldId)}"`,
    `data-workbench-path="${escapeHtml(field.path)}"`,
    field.input === 'number' ? 'type="number"' : undefined,
    field.input === 'color' ? 'type="color"' : undefined,
    field.min === undefined ? undefined : `min="${field.min}"`,
    field.max === undefined ? undefined : `max="${field.max}"`,
    field.step === undefined ? undefined : `step="${field.step}"`,
  ]
    .filter(Boolean)
    .join(' ');
  if (field.input === 'select') {
    return `<label class="field"><span>${escapeHtml(field.label)}</span><select ${baseAttrs}>${optionsHtml(field.options ?? [], String(field.value ?? ''))}</select></label>`;
  }
  if (field.input === 'checkbox') {
    const checked = field.value ? ' checked' : '';
    return `<label class="field field--inline"><input ${baseAttrs} type="checkbox"${checked} /><span>${escapeHtml(field.label)}</span></label>`;
  }
  return `<label class="field"><span>${escapeHtml(field.label)}</span><input ${baseAttrs} value="${escapeHtml(String(field.value ?? ''))}" /></label>`;
}

export function textField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: string,
  path: string,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'text', value };
}

export function numberField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: number | undefined,
  path: string,
  min?: number,
  max?: number,
  step?: number,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'number', value, min, max, step };
}

export function selectField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: string,
  path: string,
  options: Option[],
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'select', value, options };
}

export function colorField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: string,
  path: string,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'color', value };
}

export function checkboxField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: boolean,
  path: string,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'checkbox', value };
}

export function optionsHtml(options: Option[], selected: string): string {
  return options
    .map((option) => {
      const selectedAttr = option.value === selected ? ' selected' : '';
      return `<option value="${escapeHtml(option.value)}"${selectedAttr}>${escapeHtml(option.label)}</option>`;
    })
    .join('');
}

export function statusOptions(ruleset: Ruleset): Option[] {
  return ruleset.mechanics.statuses.map((status) => ({ value: status.id, label: status.name }));
}

export function resourceOptions(ruleset: Ruleset): Option[] {
  return ruleset.mechanics.resources.map((resource) => ({ value: resource.id, label: resource.name }));
}

export function objectiveOptions(ruleset: Ruleset): Option[] {
  return ruleset.objectives.map((objective) => ({ value: objective.id, label: objective.name }));
}

export function scoreZoneOptions(objective: Ruleset['objectives'][number]): Option[] {
  return objective.scoreZones.map((zone) => ({ value: zone.id, label: `${zone.id} (${zone.team})` }));
}

export function teamOptions(ruleset: Ruleset): Option[] {
  return ruleset.match.teams.map((team) => ({ value: team.id, label: team.name }));
}

export function abilityTagOptions(ruleset: Ruleset, selected: string): Option[] {
  const tags = Array.from(new Set([...ruleset.abilities.flatMap((ability) => ability.tags ?? []), selected].filter(Boolean)));
  return tags.map((tag) => ({ value: tag, label: tag }));
}

export function effectTargetOptions(values: Array<'self' | 'hit' | 'impact'>): Option[] {
  return values.map((value) => ({
    value,
    label: value === 'self' ? 'Self' : value === 'hit' ? 'Hit' : 'Impact',
  }));
}

export function defaultBody(color = '#ffffff'): PhysicsBodySpec {
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

export function effectKindLabel(kind: AbilityEffect['kind']): string {
  return EFFECT_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function conditionKindLabel(kind: MechanicCondition['kind']): string {
  return CONDITION_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function actionKindLabel(kind: MechanicAction['kind']): string {
  return ACTION_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function commandPrefix(scope: DynamicFieldSpec['scope']): string {
  if (scope === 'effect') {
    return 'effect';
  }
  if (scope === 'condition') {
    return 'condition';
  }
  if (scope === 'action') {
    return 'action';
  }
  if (scope === 'scoreZone') {
    return 'score-zone';
  }
  return scope;
}

function controlId(scope: string, index: number, fieldId: string): string {
  const scopeId = scope === 'scoreZone' ? 'score-zone' : scope;
  if (scope === 'team' || scope === 'objective' || scope === 'scoreZone') {
    return `workbench-${scopeId}-${fieldId.replace(/\./g, '-')}`;
  }
  return `workbench-${scopeId}-${index}-${fieldId.replace(/\./g, '-')}`;
}
