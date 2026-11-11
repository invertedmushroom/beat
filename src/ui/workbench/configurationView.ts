import type { ObjectiveDefinition, Ruleset } from '../../engine/protocol';
import { escapeHtml } from './inspector';

const MOVEMENT_NAMES = { twinStick: 'Twin Stick', tank: 'Heavy Tank', platform: 'Platform', orthogonal: 'Four-Way' };

export function configurationSummary(rules: Ruleset): string {
  return `${MOVEMENT_NAMES[rules.player.movement.mode]} · ${rules.maxPlayers} players · ${rules.objectives.map((objective) => objective.name).join(' / ')}`;
}

export function configurationHtml(rules: Ruleset): string {
  return `<div class="configuration-overview">
    ${arenaPreviewHtml(rules)}
    <div><h3>${escapeHtml(rules.name)}</h3><p>${escapeHtml(configurationSummary(rules))}</p>
      <p>${rules.arena.width} × ${rules.arena.height} m · Speed ${rules.player.speed} m/s · ${rules.player.maxHp} HP</p>
      <button type="button" class="button button--mini" data-kit-customize="player">Change / tune movement</button>
    </div>
  </div>
  <div class="kit-deck">${rules.loadout.abilityIds.map((id, slot) => {
    const ability = rules.abilities.find((entry) => entry.id === id);
    if (!ability) return '';
    return `<article class="kit-ability" data-current-slot="${slot}">
      <span class="kit-tag">Slot ${slot + 1} · ${escapeHtml(ability.shape)}</span>
      <strong>${escapeHtml(ability.name)}</strong>
      <p>${ability.damage} base damage · ${(ability.cooldownTicks / rules.tickRate).toFixed(2)} s cooldown · ${ability.range} m range</p>
      <button type="button" class="button button--mini" data-kit-customize="abilities" data-kit-ability-slot="${slot}">Inspect / customize ability ${slot + 1}</button>
    </article>`;
  }).join('')}</div>`;
}

/** A schematic of authored geometry, shared by library cards and edited rules. */
export function arenaPreviewHtml(rules: Ruleset): string {
  const { width, height } = rules.arena;
  const obstacles = rules.obstacles.map((box) => `<rect x="${box.x - box.halfWidth}" y="${box.y - box.halfHeight}" width="${box.halfWidth * 2}" height="${box.halfHeight * 2}" fill="#8c8778" rx="0.3" />`).join('');
  return `<svg class="kit-map" viewBox="${-width / 2 - 1} ${-height / 2 - 1} ${width + 2} ${height + 2}" aria-hidden="true">
    <rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="1" fill="#151b19" stroke="#4e6056" stroke-width="0.3" />
    ${rules.objectives.map(objectivePreviewHtml).join('')}${obstacles}
  </svg>`;
}

function objectivePreviewHtml(objective: ObjectiveDefinition): string {
  if (objective.kind === 'kingZone') return objective.zones.map((zone) => `<circle cx="${zone.x}" cy="${zone.y}" r="${zone.radius}" fill="#ffe66d" fill-opacity="0.18" stroke="#ffe66d" stroke-width="0.25" />`).join('');
  if (objective.kind !== 'relicPush') return '';
  return `<circle cx="${objective.spawn.x}" cy="${objective.spawn.y}" r="${objective.body.radius}" fill="#f5f3ed" />${objective.scoreZones.map((zone) => `<circle cx="${zone.x}" cy="${zone.y}" r="${zone.radius}" fill="${escapeHtml(zone.color ?? '#ffe66d')}" fill-opacity="0.3" />`).join('')}`;
}
