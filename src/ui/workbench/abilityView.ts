import type { Ability, AbilityEffect, MechanicCondition, MechanicTrigger, Ruleset } from '../../engine/protocol';
import { actionLabel, conditionLabel, escapeHtml } from './inspector';

/** A view of accepted rules. Nodes link to the existing editors; they own no state. */
export function abilityInspectorHtml(rules: Ruleset, abilityId: string): string {
  const ability = rules.abilities.find((entry) => entry.id === abilityId);
  if (!ability) return '';
  return `<section class="ability-inspector" aria-label="Ability overview">
    ${abilityHeaderHtml(ability)}
    ${timingHtml(ability, rules.tickRate)}
    ${abilityFlowHtml(rules, ability)}
    ${relatedTriggersHtml(rules, ability)}
    <p class="kit-footnote">Click an effect node to tune it below. Trigger nodes open Mechanics. Lab traces show which conditions actually pass.</p>
  </section>`;
}

function abilityHeaderHtml(ability: Ability): string {
  return `<div class="ability-overview">${shapePreview(ability)}<div>
      <h3>${escapeHtml(ability.name)}</h3>
      <p>${ability.shape === 'projectile' ? 'Projectile' : 'Melee arc'} · ${ability.targeting === 'free-aim' ? 'Free aim' : 'Aim assist'} · ${ability.range} m range</p>
      <p>${ability.damage} base damage · ${escapeHtml((ability.tags ?? []).join(' / '))}</p>
      <button type="button" class="button button--mini" data-ability-lab>Try this loadout in Lab</button>
    </div></div>`;
}

function abilityFlowHtml(rules: Ruleset, ability: Ability): string {
  const effects = ability.effects ?? [];
  const cast = effects.flatMap((effect, index) => isCastEffect(effect) ? [effectNode(rules, effect, index)] : []);
  const hit = effects.flatMap((effect, index) => isCastEffect(effect) ? [] : [effectNode(rules, effect, index)]);
  return `<div class="ability-flow" aria-label="Ability flow">
      <section class="ability-lane"><h4>${ability.charge ? 'Hold → release / auto-release' : 'Press → cast'}</h4>
        ${nodeHtml(ability.charge ? 'Charge' : 'Cast', ability.charge ? `Move at ${Math.round(ability.charge.moveSpeedMultiplier * 100)}% while charging` : 'Resolve aim and start cooldown')}
        <span class="flow-connector" aria-hidden="true">↓</span>
        ${nodeHtml(ability.shape === 'projectile' ? 'Launch projectile' : 'Start melee arc', ability.shape === 'projectile' ? `${ability.radius} m hit radius` : `${ability.arcDegrees}° sweep`)}
      </section>
      <section class="ability-lane"><h4>On cast / release · caster</h4>${cast.join('') || '<p class="kit-intro">No extra caster effects</p>'}</section>
      <section class="ability-lane"><h4>On player hit</h4>${nodeHtml('Base damage', String(ability.damage))}${hit.join('')}</section>
    </div>`;
}

function isCastEffect(effect: AbilityEffect): boolean {
  return effect.kind === 'selfDash' || ('target' in effect && effect.target === 'self');
}

function nodeHtml(title: string, detail: string): string {
  return `<div class="ability-node"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function effectNode(rules: Ruleset, effect: AbilityEffect, index: number): string {
  return `<a class="ability-node ability-node--effect" href="#workbench-effect-${index}">
    <strong>${escapeHtml(effectTitle(effect))}</strong><small>${escapeHtml(effectDetail(rules, effect))}</small></a>`;
}

function effectTitle(effect: AbilityEffect): string {
  const titles: Record<AbilityEffect['kind'], string> = {
    selfDash: 'Self dash', knockback: 'Knockback', slow: 'Slow', heal: 'Heal',
    applyStatus: 'Apply status', spawnBody: 'Spawn body', snare: 'Snare', dragBody: 'Tether body',
  };
  return titles[effect.kind];
}

function effectDetail(rules: Ruleset, effect: AbilityEffect): string {
  switch (effect.kind) {
    case 'selfDash': return `${effect.distance} m · blocked by arena geometry`;
    case 'knockback': return `${effect.force} m displacement`;
    case 'slow': return `${Math.round(effect.multiplier * 100)}% movement · ${seconds(effect.durationTicks, rules.tickRate)}`;
    case 'heal': return `${effect.amount} HP`;
    case 'spawnBody': return `${effect.target} · radius ${effect.body.radius} m · mass ${effect.body.mass}`;
    case 'snare': return `Leash ${effect.radius} m · ${seconds(effect.durationTicks, rules.tickRate)}`;
    case 'dragBody': return `Leash ${effect.leashLength} m · mass ${effect.body.mass}`;
    case 'applyStatus': return statusDetail(rules, effect);
  }
}

function statusDetail(rules: Ruleset, effect: Extract<AbilityEffect, { kind: 'applyStatus' }>): string {
  const status = rules.mechanics.statuses.find((entry) => entry.id === effect.statusId);
  if (!status) return effect.statusId;
  const duration = seconds(effect.durationTicks ?? status.durationTicks, rules.tickRate);
  const movement = status.movementMultiplier === undefined ? '' : ` · ${Math.round(status.movementMultiplier * 100)}% movement`;
  return `${status.name} · ${duration}${movement}${status.periodic ? ' · periodic actions' : ''}`;
}

function timingHtml(ability: Ability, tickRate: number): string {
  const phases: Array<[string, number]> = [];
  if (ability.charge) phases.push(['Max charge', ability.charge.maxTicks]);
  if (ability.shape === 'melee') phases.push(['Windup', ability.windupTicks], ['Active', ability.activeTicks]);
  if (ability.shape === 'projectile') phases.push(['Projectile lifetime', ability.lifetimeTicks]);
  phases.push(['Cooldown from cast', ability.cooldownTicks]);
  return `<div class="ability-timing" aria-label="Ability timing">${phases.map(([name, ticks]) =>
    `<div><small>${name}</small><strong>${seconds(ticks, tickRate)}</strong><span>${ticks} ticks</span></div>`).join('')}</div>`;
}

function seconds(ticks: number, tickRate: number): string {
  return `${(ticks / tickRate).toFixed(2)} s`;
}

function shapePreview(ability: Ability): string {
  const geometry = ability.shape === 'projectile'
    ? '<path d="M 35 50 H 202" stroke="currentColor" stroke-dasharray="5 5"/><circle cx="190" cy="50" r="8" fill="currentColor"/>'
    : meleeArc(ability.arcDegrees);
  return `<svg class="ability-shape" viewBox="0 0 240 100" role="img" aria-label="${escapeHtml(ability.name)} hit shape schematic">
    <title>${escapeHtml(ability.name)}: ${ability.range} m range, ${ability.radius} m radius</title>
    <g style="color:${escapeHtml(ability.color)}">${geometry}</g>
    <circle cx="35" cy="50" r="10" fill="#f5f3ed"/><text x="120" y="94" text-anchor="middle" fill="#b9b4a8" font-size="10">Schematic · ${ability.range} m range</text></svg>`;
}

function meleeArc(degrees: number): string {
  const half = degrees * Math.PI / 360;
  const x = 35 + Math.cos(half) * 65, y = Math.sin(half) * 65;
  return `<path d="M 35 50 L ${x} ${50 - y} A 65 65 0 ${degrees > 180 ? 1 : 0} 1 ${x} ${50 + y} Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor"/>`;
}

export function relatedAbilityTriggers(rules: Ruleset, ability: Ability): MechanicTrigger[] {
  return rules.mechanics.triggers.filter((trigger) => ['onCast', 'onHit', 'onKill'].includes(trigger.event) &&
    (trigger.conditions ?? []).every((condition) => canMatchAbility(condition, rules, ability)));
}

function canMatchAbility(condition: MechanicCondition, rules: Ruleset, ability: Ability): boolean {
  if (condition.kind === 'abilityTag') return ability.tags?.includes(condition.tag) ?? false;
  if (condition.kind === 'slotUsed') return rules.loadout.abilityIds[condition.slot] === ability.id;
  return condition.kind !== 'objectiveId' && condition.kind !== 'scoringTeam';
}

function relatedTriggersHtml(rules: Ruleset, ability: Ability): string {
  const triggers = relatedAbilityTriggers(rules, ability);
  return `<section class="ability-triggers"><h4>Potential cast / hit / kill triggers</h4>
    <p class="kit-intro">Enabled in this configuration. Each trigger still checks its runtime conditions.</p>
    <div class="ability-trigger-list">${triggers.map((trigger) => `<button type="button" class="ability-node ability-node--trigger" data-inspect-trigger="${escapeHtml(trigger.id)}">
      <strong>${escapeHtml(trigger.name ?? trigger.id)}</strong><small>${escapeHtml(trigger.event)}</small>
      <small>If ${(trigger.conditions ?? []).map(conditionLabel).map(escapeHtml).join(' + ') || 'always'}</small>
      <small>Then ${trigger.actions.map(actionLabel).map(escapeHtml).join(' + ')}</small></button>`).join('') || '<p class="kit-intro">No matching triggers. Explore Add mechanics in the Library.</p>'}</div></section>`;
}
