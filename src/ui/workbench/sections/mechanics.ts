import type { MechanicAction, MechanicCondition, Ruleset } from '../../../engine/protocol';
import {
  ACTION_KIND_OPTIONS,
  CONDITION_KIND_OPTIONS,
  MECHANIC_TARGET_OPTIONS,
  abilityTagOptions,
  actionKindLabel,
  colorField,
  conditionKindLabel,
  fieldsHtml,
  kindSelectHtml,
  numberField,
  objectiveOptions,
  resourceOptions,
  rowButtonsHtml,
  rowShell,
  sectionShell,
  selectField,
  statusOptions,
  teamOptions,
} from './controls';

export function mechanicsChainHtml(ruleset: Ruleset, selectedTriggerId: string): string {
  const trigger = ruleset.mechanics.triggers.find((candidate) => candidate.id === selectedTriggerId) ?? ruleset.mechanics.triggers[0];
  if (!trigger) {
    return sectionShell('Trigger Chain', '<div class="workbench-chain__empty">No trigger selected</div>');
  }
  const conditionRows =
    (trigger.conditions?.length ?? 0) > 0
      ? trigger.conditions?.map((condition, index) => conditionRowHtml(ruleset, trigger, condition, index, trigger.conditions?.length ?? 0)).join('')
      : '<div class="workbench-chain__empty">No conditions</div>';
  const actionRows = trigger.actions.map((action, index) => actionRowHtml(ruleset, trigger, action, index, trigger.actions.length)).join('');
  return sectionShell(
    'Trigger Chain',
    `
      <div class="workbench-chain__group">
        <div class="workbench-chain__toolbar">
          <h3>Conditions</h3>
          <button id="workbench-add-condition" class="button" type="button" data-condition-command="add">Add condition</button>
        </div>
        ${conditionRows}
      </div>
      <div class="workbench-chain__group">
        <div class="workbench-chain__toolbar">
          <h3>Actions</h3>
          <button id="workbench-add-action" class="button" type="button" data-action-command="add">Add action</button>
        </div>
        ${actionRows}
      </div>
    `,
  );
}

function conditionRowHtml(
  ruleset: Ruleset,
  trigger: Ruleset['mechanics']['triggers'][number],
  condition: MechanicCondition,
  index: number,
  count: number,
): string {
  const path = (fieldId: string) => `mechanics.triggers[${trigger.id}].conditions[${index}].${fieldId}`;
  return rowShell(
    'condition',
    index,
    `${index + 1}. ${conditionKindLabel(condition.kind)}`,
    kindSelectHtml('condition', index, path('kind'), CONDITION_KIND_OPTIONS, condition.kind),
    conditionFieldsHtml(ruleset, condition, index, path),
    rowButtonsHtml('condition', index, count, true),
  );
}

function actionRowHtml(
  ruleset: Ruleset,
  trigger: Ruleset['mechanics']['triggers'][number],
  action: MechanicAction,
  index: number,
  count: number,
): string {
  const path = (fieldId: string) => `mechanics.triggers[${trigger.id}].actions[${index}].${fieldId}`;
  return rowShell(
    'action',
    index,
    `${index + 1}. ${actionKindLabel(action.kind)}`,
    kindSelectHtml('action', index, path('kind'), ACTION_KIND_OPTIONS, action.kind),
    actionFieldsHtml(ruleset, action, index, path),
    rowButtonsHtml('action', index, count, count > 1),
  );
}

function conditionFieldsHtml(
  ruleset: Ruleset,
  condition: MechanicCondition,
  index: number,
  path: (fieldId: string) => string,
): string {
  if (condition.kind === 'hasStatus' || condition.kind === 'missingStatus') {
    return fieldsHtml([
      selectField('condition', index, 'target', 'Target', condition.target, path('target'), MECHANIC_TARGET_OPTIONS),
      selectField('condition', index, 'statusId', 'Status', condition.statusId, path('statusId'), statusOptions(ruleset)),
    ]);
  }
  if (condition.kind === 'hpBelow') {
    return fieldsHtml([
      selectField('condition', index, 'target', 'Target', condition.target, path('target'), MECHANIC_TARGET_OPTIONS),
      numberField('condition', index, 'ratio', 'Ratio', condition.ratio, path('ratio'), 0, 1, 0.05),
    ]);
  }
  if (condition.kind === 'resourceAtLeast') {
    return fieldsHtml([
      selectField('condition', index, 'target', 'Target', condition.target, path('target'), MECHANIC_TARGET_OPTIONS),
      selectField('condition', index, 'resourceId', 'Resource', condition.resourceId, path('resourceId'), resourceOptions(ruleset)),
      numberField('condition', index, 'amount', 'Amount', condition.amount, path('amount'), 0, 100000, 1),
    ]);
  }
  if (condition.kind === 'slotUsed') {
    return fieldsHtml([
      selectField('condition', index, 'slot', 'Slot', String(condition.slot), path('slot'), [
        { value: '0', label: 'Slot 1' },
        { value: '1', label: 'Slot 2' },
        { value: '2', label: 'Slot 3' },
        { value: '3', label: 'Slot 4' },
      ]),
    ]);
  }
  if (condition.kind === 'abilityTag') {
    return fieldsHtml([selectField('condition', index, 'tag', 'Tag', condition.tag, path('tag'), abilityTagOptions(ruleset, condition.tag))]);
  }
  if (condition.kind === 'objectiveId') {
    return fieldsHtml([selectField('condition', index, 'objectiveId', 'Objective', condition.objectiveId, path('objectiveId'), objectiveOptions(ruleset))]);
  }
  return fieldsHtml([selectField('condition', index, 'teamId', 'Team', condition.teamId, path('teamId'), teamOptions(ruleset))]);
}

function actionFieldsHtml(ruleset: Ruleset, action: MechanicAction, index: number, path: (fieldId: string) => string): string {
  if (action.kind === 'applyStatus') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      selectField('action', index, 'statusId', 'Status', action.statusId, path('statusId'), statusOptions(ruleset)),
      numberField('action', index, 'durationTicks', 'Duration ticks', action.durationTicks, path('durationTicks'), 1, 3600, 1),
      numberField('action', index, 'stacks', 'Stacks', action.stacks, path('stacks'), 1, 50, 1),
    ]);
  }
  if (action.kind === 'removeStatus') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      selectField('action', index, 'statusId', 'Status', action.statusId, path('statusId'), statusOptions(ruleset)),
    ]);
  }
  if (action.kind === 'dealDamage') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      numberField('action', index, 'amount', 'Amount', action.amount, path('amount'), 0, 10000, 1),
      colorField('action', index, 'color', 'Color', action.color ?? '#ffffff', path('color')),
    ]);
  }
  if (action.kind === 'heal') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      numberField('action', index, 'amount', 'Amount', action.amount, path('amount'), 0, 10000, 1),
    ]);
  }
  if (action.kind === 'knockback') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      numberField('action', index, 'force', 'Force', action.force, path('force'), 0.05, 12, 0.05),
      selectField('action', index, 'direction', 'Direction', action.direction ?? 'sourceToTarget', path('direction'), [
        { value: 'sourceToTarget', label: 'Source to target' },
        { value: 'targetToSource', label: 'Target to source' },
        { value: 'aim', label: 'Aim' },
      ]),
      colorField('action', index, 'color', 'Color', action.color ?? '#ffffff', path('color')),
    ]);
  }
  if (action.kind === 'slow') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      numberField('action', index, 'multiplier', 'Multiplier', action.multiplier, path('multiplier'), 0.05, 1, 0.05),
      numberField('action', index, 'durationTicks', 'Duration ticks', action.durationTicks, path('durationTicks'), 1, 1200, 1),
      colorField('action', index, 'color', 'Color', action.color ?? '#7aa8ff', path('color')),
    ]);
  }
  if (action.kind === 'modifyResource') {
    return fieldsHtml([
      selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
      selectField('action', index, 'resourceId', 'Resource', action.resourceId, path('resourceId'), resourceOptions(ruleset)),
      numberField('action', index, 'amount', 'Amount', action.amount, path('amount'), -100000, 100000, 1),
    ]);
  }
  return fieldsHtml([
    selectField('action', index, 'target', 'Target', action.target, path('target'), MECHANIC_TARGET_OPTIONS),
    numberField('action', index, 'radius', 'Radius', action.radius, path('radius'), 0.05, 30, 0.05),
    colorField('action', index, 'color', 'Color', action.color ?? '#ffffff', path('color')),
  ]);
}
