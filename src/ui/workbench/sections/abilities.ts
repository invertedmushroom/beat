import type { AbilityEffect, PhysicsBodySpec, Ruleset } from '../../../engine/protocol';
import {
  EFFECT_KIND_OPTIONS,
  colorField,
  defaultBody,
  effectKindLabel,
  effectTargetOptions,
  fieldsHtml,
  kindSelectHtml,
  numberField,
  rowButtonsHtml,
  rowShell,
  sectionShell,
  selectField,
} from './controls';

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
      selectField(
        'effect',
        index,
        'statusId',
        'Status',
        effect.statusId,
        path('statusId'),
        ruleset.mechanics.statuses.map((status) => ({ value: status.id, label: status.name })),
      ),
      numberField('effect', index, 'durationTicks', 'Duration ticks', effect.durationTicks, path('durationTicks'), 1, 3600, 1),
      numberField('effect', index, 'stacks', 'Stacks', effect.stacks, path('stacks'), 1, 50, 1),
    ]);
  }
  if (effect.kind === 'spawnBody') {
    return fieldsHtml([
      selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['self', 'hit', 'impact'])),
      numberField('effect', index, 'inheritVelocity', 'Inherit velocity', effect.inheritVelocity, path('inheritVelocity'), 0, 4, 0.05),
      ...bodyFields(index, effect.body, path),
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
      ...(effect.anchor === 'body' || effect.body ? bodyFields(index, effect.body ?? defaultBody(effect.color), path) : []),
    ]);
  }
  return fieldsHtml([
    selectField('effect', index, 'target', 'Target', effect.target, path('target'), effectTargetOptions(['self', 'hit'])),
    numberField('effect', index, 'durationTicks', 'Duration ticks', effect.durationTicks, path('durationTicks'), 1, 3600, 1),
    numberField('effect', index, 'leashLength', 'Leash length', effect.leashLength, path('leashLength'), 0.2, 30, 0.05),
    numberField('effect', index, 'stiffness', 'Stiffness', effect.stiffness, path('stiffness'), 1, 2000, 1),
    numberField('effect', index, 'damping', 'Damping', effect.damping, path('damping'), 0, 200, 0.5),
    colorField('effect', index, 'color', 'Color', effect.color ?? '#ffffff', path('color')),
    ...bodyFields(index, effect.body, path),
  ]);
}

function bodyFields(index: number, body: PhysicsBodySpec, path: (fieldId: string) => string) {
  return [
    numberField('effect', index, 'body.radius', 'Body radius', body.radius, path('body.radius'), 0.05, 5, 0.05),
    numberField('effect', index, 'body.mass', 'Body mass', body.mass, path('body.mass'), 0.05, 200, 0.05),
    numberField('effect', index, 'body.friction', 'Body friction', body.friction, path('body.friction'), 0, 5, 0.05),
    numberField('effect', index, 'body.restitution', 'Restitution', body.restitution, path('body.restitution'), 0, 2, 0.05),
    numberField('effect', index, 'body.linearDamping', 'Body damping', body.linearDamping, path('body.linearDamping'), 0, 40, 0.05),
    numberField('effect', index, 'body.lifetimeTicks', 'Body lifetime', body.lifetimeTicks, path('body.lifetimeTicks'), 1, 3600, 1),
    colorField('effect', index, 'body.color', 'Body color', body.color, path('body.color')),
  ];
}
