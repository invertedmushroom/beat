import type { AbilityEffect, MechanicAction, MechanicCondition, PhysicsBodySpec, Ruleset } from '../../engine/protocol';
import { escapeHtml } from './inspector';
import type { WorkbenchState } from './state';

type Option = { value: string; label: string };

type DynamicFieldSpec = {
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

const EFFECT_KIND_OPTIONS: Array<{ value: AbilityEffect['kind']; label: string }> = [
  { value: 'knockback', label: 'Knockback' },
  { value: 'slow', label: 'Slow' },
  { value: 'heal', label: 'Heal' },
  { value: 'selfDash', label: 'Self dash' },
  { value: 'applyStatus', label: 'Apply status' },
  { value: 'spawnBody', label: 'Spawn body' },
  { value: 'snare', label: 'Snare' },
  { value: 'dragBody', label: 'Drag body' },
];

const CONDITION_KIND_OPTIONS: Array<{ value: MechanicCondition['kind']; label: string }> = [
  { value: 'hasStatus', label: 'Has status' },
  { value: 'missingStatus', label: 'Missing status' },
  { value: 'hpBelow', label: 'HP below' },
  { value: 'resourceAtLeast', label: 'Resource at least' },
  { value: 'slotUsed', label: 'Slot used' },
  { value: 'abilityTag', label: 'Ability tag' },
  { value: 'objectiveId', label: 'Objective' },
  { value: 'scoringTeam', label: 'Scoring team' },
];

const ACTION_KIND_OPTIONS: Array<{ value: MechanicAction['kind']; label: string }> = [
  { value: 'applyStatus', label: 'Apply status' },
  { value: 'removeStatus', label: 'Remove status' },
  { value: 'dealDamage', label: 'Deal damage' },
  { value: 'heal', label: 'Heal' },
  { value: 'knockback', label: 'Knockback' },
  { value: 'slow', label: 'Slow' },
  { value: 'modifyResource', label: 'Modify resource' },
  { value: 'flashEffect', label: 'Flash effect' },
];

const MECHANIC_TARGET_OPTIONS: Option[] = [
  { value: 'source', label: 'Source' },
  { value: 'target', label: 'Target' },
];

export function abilityEffectsHtml(ruleset: Ruleset, selectedAbilityId: string): string {
  const ability = ruleset.abilities.find((candidate) => candidate.id === selectedAbilityId) ?? ruleset.abilities[0];
  if (!ability) {
    return sectionShell('Ability Effects', '<div class="workbench-chain__empty">No ability selected</div>');
  }
  const effects = ability.effects ?? [];
  const rows =
    effects.length > 0
      ? effects.map((effect, index) => effectRowHtml(ruleset, ability, effect, index, effects.length)).join('')
      : '<div class="workbench-chain__empty">No effects</div>';
  return sectionShell(
    'Ability Effects',
    `
      <div class="workbench-chain__toolbar">
        <button id="workbench-add-effect" class="button" type="button" data-effect-command="add">Add effect</button>
      </div>
      ${rows}
    `,
  );
}

export function matchGameTypeLabel(ruleset: Ruleset): string {
  if (ruleset.objectives.length === 0) {
    return 'No objective scoring';
  }
  if (ruleset.objectives.some((objective) => objective.kind !== 'relicPush')) {
    return 'Custom objective rules';
  }
  if (ruleset.objectives.length !== 1) {
    return 'Custom Relic Push';
  }
  const objective = ruleset.objectives[0];
  const teamIds = new Set(ruleset.match.teams.map((team) => team.id));
  const zoneTeams = objective?.scoreZones.map((zone) => zone.team) ?? [];
  const hasOneZonePerTeam = zoneTeams.length === teamIds.size && zoneTeams.every((team) => teamIds.has(team)) && new Set(zoneTeams).size === zoneTeams.length;
  return hasOneZonePerTeam ? 'Relic Push' : 'Custom Relic Push';
}

export function matchObjectivesHtml(ruleset: Ruleset, state: WorkbenchState): string {
  const team = selectedTeam(ruleset, state.selectedTeamId);
  const objective = selectedObjective(ruleset, state.selectedObjectiveId);
  const zone = objective ? selectedScoreZone(objective, state.selectedScoreZoneId) : undefined;
  return [
    sectionShell(
      'Game Type',
      `
        <div class="workbench-summary">
          <strong>${escapeHtml(matchGameTypeLabel(ruleset))}</strong>
          <span>${escapeHtml(matchGameTypeDetail(ruleset))}</span>
        </div>
      `,
    ),
    sectionShell(
      'Teams',
      `
        <div class="workbench-grid workbench-grid--chain">
          <label class="field"><span>Edit team</span><select id="workbench-team-select" data-team-select="true" data-workbench-path="match.teams">${optionsHtml(
            teamOptions(ruleset),
            team?.id ?? '',
          )}</select></label>
          ${team ? teamFieldsHtml(team) : '<div class="workbench-chain__empty">No teams</div>'}
        </div>
      `,
    ),
    sectionShell(
      'Objectives',
      objective
        ? `
          <div class="workbench-grid workbench-grid--chain">
            <label class="field"><span>Edit objective</span><select id="workbench-objective-select" data-objective-select="true" data-workbench-path="objectives">${optionsHtml(
              objectiveOptions(ruleset),
              objective.id,
            )}</select></label>
            ${objectiveFieldsHtml(objective)}
          </div>
          <div class="workbench-chain__group">
            <div class="workbench-chain__toolbar">
              <h3>Score Zones</h3>
              <div class="workbench-mini-actions">
                <button id="workbench-add-score-zone" class="button button--mini" type="button" data-score-zone-command="add">Add zone</button>
                <button id="workbench-duplicate-score-zone" class="button button--mini" type="button" data-score-zone-command="duplicate" data-score-zone-id="${escapeHtml(
                  zone?.id ?? '',
                )}"${zone ? '' : ' disabled'}>Duplicate</button>
                <button id="workbench-remove-score-zone" class="button button--mini button--danger" type="button" data-score-zone-command="remove" data-score-zone-id="${escapeHtml(
                  zone?.id ?? '',
                )}"${objective.scoreZones.length <= 1 || !zone ? ' disabled' : ''}>Remove</button>
              </div>
            </div>
            <div class="workbench-grid workbench-grid--chain">
              <label class="field"><span>Edit zone</span><select id="workbench-score-zone-select" data-score-zone-select="true" data-workbench-path="objectives[${escapeHtml(
                objective.id,
              )}].scoreZones">${optionsHtml(scoreZoneOptions(objective), zone?.id ?? '')}</select></label>
              ${zone ? scoreZoneFieldsHtml(ruleset, objective, zone) : '<div class="workbench-chain__empty">No score zones</div>'}
            </div>
          </div>
        `
        : '<div class="workbench-chain__empty">No objective scoring</div>',
    ),
  ].join('');
}

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

function effectRowHtml(
  ruleset: Ruleset,
  ability: Ruleset['abilities'][number],
  effect: AbilityEffect,
  index: number,
  count: number,
): string {
  const path = (fieldId: string) => `abilities[${ability.id}].effects[${index}].${fieldId}`;
  return rowShell(
    'effect',
    index,
    `${index + 1}. ${effectKindLabel(effect.kind)}`,
    kindSelectHtml('effect', index, path('kind'), EFFECT_KIND_OPTIONS, effect.kind),
    effectFieldsHtml(ruleset, effect, index, path),
    rowButtonsHtml('effect', index, count, true),
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

function effectFieldsHtml(
  ruleset: Ruleset,
  effect: AbilityEffect,
  index: number,
  path: (fieldId: string) => string,
): string {
  if (effect.kind === 'knockback') {
    return fieldsHtml([numberField('effect', index, 'force', 'Force', effect.force, path('force'), 0.05, 12, 0.05)]);
  }
  if (effect.kind === 'slow') {
    return fieldsHtml([
      numberField('effect', index, 'multiplier', 'Multiplier', effect.multiplier, path('multiplier'), 0.05, 1, 0.05),
      numberField('effect', index, 'durationTicks', 'Duration ticks', effect.durationTicks, path('durationTicks'), 1, 1200, 1),
    ]);
  }
  if (effect.kind === 'heal') {
    return fieldsHtml([
      selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['self', 'hit'])),
      numberField('effect', index, 'amount', 'Amount', effect.amount, path('amount'), 0, 10000, 1),
    ]);
  }
  if (effect.kind === 'selfDash') {
    return fieldsHtml([numberField('effect', index, 'distance', 'Distance', effect.distance, path('distance'), 0.05, 12, 0.05)]);
  }
  if (effect.kind === 'applyStatus') {
    return fieldsHtml([
      selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['self', 'hit'])),
      selectField('effect', index, 'statusId', 'Status', effect.statusId, path('statusId'), statusOptions(ruleset)),
      numberField('effect', index, 'durationTicks', 'Duration ticks', effect.durationTicks, path('durationTicks'), 1, 3600, 1),
      numberField('effect', index, 'stacks', 'Stacks', effect.stacks, path('stacks'), 1, 50, 1),
    ]);
  }
  if (effect.kind === 'spawnBody') {
    return fieldsHtml([
      selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['self', 'hit', 'impact'])),
      numberField('effect', index, 'inheritVelocity', 'Inherit velocity', effect.inheritVelocity, path('inheritVelocity'), 0, 4, 0.05),
      ...bodyFields('effect', index, effect.body, path),
    ]);
  }
  if (effect.kind === 'snare') {
    return fieldsHtml([
      selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['hit'])),
      selectField('effect', index, 'anchor', 'Anchor', effect.anchor, path('anchor'), [
        { value: 'impact', label: 'Impact' },
        { value: 'body', label: 'Body' },
      ]),
      numberField('effect', index, 'durationTicks', 'Duration ticks', effect.durationTicks, path('durationTicks'), 1, 3600, 1),
      numberField('effect', index, 'radius', 'Radius', effect.radius, path('radius'), 0.2, 30, 0.05),
      numberField('effect', index, 'stiffness', 'Stiffness', effect.stiffness, path('stiffness'), 1, 2000, 1),
      numberField('effect', index, 'damping', 'Damping', effect.damping, path('damping'), 0, 200, 0.5),
      colorField('effect', index, 'color', 'Color', effect.color ?? '#ffffff', path('color')),
      ...(effect.anchor === 'body' || effect.body ? bodyFields('effect', index, effect.body ?? defaultBody(effect.color), path) : []),
    ]);
  }
  return fieldsHtml([
    selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['self', 'hit'])),
    numberField('effect', index, 'durationTicks', 'Duration ticks', effect.durationTicks, path('durationTicks'), 1, 3600, 1),
    numberField('effect', index, 'leashLength', 'Leash length', effect.leashLength, path('leashLength'), 0.2, 30, 0.05),
    numberField('effect', index, 'stiffness', 'Stiffness', effect.stiffness, path('stiffness'), 1, 2000, 1),
    numberField('effect', index, 'damping', 'Damping', effect.damping, path('damping'), 0, 200, 0.5),
    colorField('effect', index, 'color', 'Color', effect.color ?? '#ffffff', path('color')),
    ...bodyFields('effect', index, effect.body, path),
  ]);
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

function bodyFields(scope: 'effect', index: number, body: PhysicsBodySpec, path: (fieldId: string) => string): DynamicFieldSpec[] {
  return [
    numberField(scope, index, 'body.radius', 'Body radius', body.radius, path('body.radius'), 0.05, 5, 0.05),
    numberField(scope, index, 'body.mass', 'Body mass', body.mass, path('body.mass'), 0.05, 200, 0.05),
    numberField(scope, index, 'body.friction', 'Body friction', body.friction, path('body.friction'), 0, 5, 0.05),
    numberField(scope, index, 'body.restitution', 'Restitution', body.restitution, path('body.restitution'), 0, 2, 0.05),
    numberField(scope, index, 'body.linearDamping', 'Body damping', body.linearDamping, path('body.linearDamping'), 0, 40, 0.05),
    numberField(scope, index, 'body.lifetimeTicks', 'Body lifetime', body.lifetimeTicks, path('body.lifetimeTicks'), 1, 3600, 1),
    colorField(scope, index, 'body.color', 'Body color', body.color, path('body.color')),
  ];
}

function teamFieldsHtml(team: Ruleset['match']['teams'][number]): string {
  const path = (fieldId: string) => `match.teams[${team.id}].${fieldId}`;
  return fieldsHtml([
    textField('team', 0, 'name', 'Team name', team.name, path('name')),
    colorField('team', 0, 'color', 'Team color', team.color, path('color')),
  ]);
}

function objectiveFieldsHtml(objective: Ruleset['objectives'][number]): string {
  const path = (fieldId: string) => `objectives[${objective.id}].${fieldId}`;
  return fieldsHtml([
    textField('objective', 0, 'name', 'Objective name', objective.name, path('name')),
    numberField('objective', 0, 'spawn.x', 'Spawn X', objective.spawn.x, path('spawn.x'), -200, 200, 0.1),
    numberField('objective', 0, 'spawn.y', 'Spawn Y', objective.spawn.y, path('spawn.y'), -200, 200, 0.1),
    numberField('objective', 0, 'body.radius', 'Body radius', objective.body.radius, path('body.radius'), 0.05, 5, 0.05),
    numberField('objective', 0, 'body.mass', 'Body mass', objective.body.mass, path('body.mass'), 0.05, 200, 0.05),
    colorField('objective', 0, 'body.color', 'Body color', objective.body.color, path('body.color')),
    numberField('objective', 0, 'scoreCooldownTicks', 'Score cooldown', objective.scoreCooldownTicks, path('scoreCooldownTicks'), 0, 1200, 1),
    checkboxField('objective', 0, 'resetOnScore', 'Reset on score', objective.resetOnScore, path('resetOnScore')),
  ]);
}

function scoreZoneFieldsHtml(
  ruleset: Ruleset,
  objective: Ruleset['objectives'][number],
  zone: Ruleset['objectives'][number]['scoreZones'][number],
): string {
  const path = (fieldId: string) => `objectives[${objective.id}].scoreZones[${zone.id}].${fieldId}`;
  const team = ruleset.match.teams.find((candidate) => candidate.id === zone.team);
  return fieldsHtml([
    selectField('scoreZone', 0, 'team', 'Scoring team', zone.team, path('team'), teamOptions(ruleset)),
    numberField('scoreZone', 0, 'x', 'Zone X', zone.x, path('x'), -200, 200, 0.1),
    numberField('scoreZone', 0, 'y', 'Zone Y', zone.y, path('y'), -200, 200, 0.1),
    numberField('scoreZone', 0, 'radius', 'Zone radius', zone.radius, path('radius'), 0.2, 30, 0.05),
    numberField('scoreZone', 0, 'points', 'Points', zone.points, path('points'), 1, 100, 1),
    colorField('scoreZone', 0, 'color', 'Zone color', zone.color ?? team?.color ?? '#ffffff', path('color')),
  ]);
}

function sectionShell(title: string, body: string): string {
  return `
    <section class="workbench-chain__section">
      <h3>${escapeHtml(title)}</h3>
      ${body}
    </section>
  `;
}

function rowShell(scope: 'effect' | 'condition' | 'action', index: number, title: string, kindControl: string, fields: string, buttons: string): string {
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

function rowButtonsHtml(scope: 'effect' | 'condition' | 'action', index: number, count: number, canRemove: boolean): string {
  const prefix = commandPrefix(scope);
  return [
    `<button class="button button--mini" type="button" data-${prefix}-command="moveUp" data-${prefix}-index="${index}"${index === 0 ? ' disabled' : ''}>Up</button>`,
    `<button class="button button--mini" type="button" data-${prefix}-command="moveDown" data-${prefix}-index="${index}"${index >= count - 1 ? ' disabled' : ''}>Down</button>`,
    `<button class="button button--mini button--danger" type="button" data-${prefix}-command="remove" data-${prefix}-index="${index}"${canRemove ? '' : ' disabled'}>Remove</button>`,
  ].join('');
}

function kindSelectHtml<T extends string>(
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

function fieldsHtml(fields: DynamicFieldSpec[]): string {
  return fields.map(fieldHtml).join('');
}

function fieldHtml(field: DynamicFieldSpec): string {
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

function textField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: string,
  path: string,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'text', value };
}

function numberField(
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

function selectField(
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

function colorField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: string,
  path: string,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'color', value };
}

function checkboxField(
  scope: DynamicFieldSpec['scope'],
  index: number,
  fieldId: string,
  label: string,
  value: boolean,
  path: string,
): DynamicFieldSpec {
  return { scope, index, fieldId, label, path, input: 'checkbox', value };
}

function optionsHtml(options: Option[], selected: string): string {
  return options
    .map((option) => {
      const selectedAttr = option.value === selected ? ' selected' : '';
      return `<option value="${escapeHtml(option.value)}"${selectedAttr}>${escapeHtml(option.label)}</option>`;
    })
    .join('');
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

function statusOptions(ruleset: Ruleset): Option[] {
  return ruleset.mechanics.statuses.map((status) => ({ value: status.id, label: status.name }));
}

function resourceOptions(ruleset: Ruleset): Option[] {
  return ruleset.mechanics.resources.map((resource) => ({ value: resource.id, label: resource.name }));
}

function objectiveOptions(ruleset: Ruleset): Option[] {
  return ruleset.objectives.map((objective) => ({ value: objective.id, label: objective.name }));
}

function scoreZoneOptions(objective: Ruleset['objectives'][number]): Option[] {
  return objective.scoreZones.map((zone) => ({ value: zone.id, label: `${zone.id} (${zone.team})` }));
}

function teamOptions(ruleset: Ruleset): Option[] {
  return ruleset.match.teams.map((team) => ({ value: team.id, label: team.name }));
}

function selectedTeam(ruleset: Ruleset, teamId: string): Ruleset['match']['teams'][number] | undefined {
  return ruleset.match.teams.find((candidate) => candidate.id === teamId) ?? ruleset.match.teams[0];
}

function selectedObjective(ruleset: Ruleset, objectiveId: string): Ruleset['objectives'][number] | undefined {
  return ruleset.objectives.find((candidate) => candidate.id === objectiveId) ?? ruleset.objectives[0];
}

function selectedScoreZone(
  objective: Ruleset['objectives'][number],
  scoreZoneId: string,
): Ruleset['objectives'][number]['scoreZones'][number] | undefined {
  return objective.scoreZones.find((candidate) => candidate.id === scoreZoneId) ?? objective.scoreZones[0];
}

function matchGameTypeDetail(ruleset: Ruleset): string {
  const objectiveCount = ruleset.objectives.length;
  const zoneCount = ruleset.objectives.reduce((total, objective) => total + objective.scoreZones.length, 0);
  return `${objectiveCount} objectives · ${zoneCount} zones · score ${ruleset.match.scoreLimit}`;
}

function abilityTagOptions(ruleset: Ruleset, selected: string): Option[] {
  const tags = Array.from(new Set([...ruleset.abilities.flatMap((ability) => ability.tags ?? []), selected].filter(Boolean)));
  return tags.map((tag) => ({ value: tag, label: tag }));
}

function effectTargetOptions(values: Array<'self' | 'hit' | 'impact'>): Option[] {
  return values.map((value) => ({
    value,
    label: value === 'self' ? 'Self' : value === 'hit' ? 'Hit' : 'Impact',
  }));
}

function defaultBody(color = '#ffffff'): PhysicsBodySpec {
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

function effectKindLabel(kind: AbilityEffect['kind']): string {
  return EFFECT_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function conditionKindLabel(kind: MechanicCondition['kind']): string {
  return CONDITION_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function actionKindLabel(kind: MechanicAction['kind']): string {
  return ACTION_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}
