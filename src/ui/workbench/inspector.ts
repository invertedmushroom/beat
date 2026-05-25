import type { AiTraceSnapshot, MechanicAction, MechanicCondition, MechanicTraceSnapshot, Ruleset } from '../../engine/protocol';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#039;';
    }
  });
}

export function mechanicsFlowHtml(ruleset: Ruleset): string {
  return ruleset.mechanics.triggers
    .map(
      (trigger) => `
        <div class="mechanics-flow__row">
          <span class="mechanics-flow__node">${escapeHtml(trigger.event)}</span>
          <span class="mechanics-flow__arrow">-&gt;</span>
          <span class="mechanics-flow__node">${escapeHtml(trigger.conditions?.map(conditionLabel).join(' + ') ?? 'always')}</span>
          <span class="mechanics-flow__arrow">-&gt;</span>
          <span class="mechanics-flow__node">${escapeHtml(trigger.actions.map(actionLabel).join(' + '))}</span>
        </div>
      `,
    )
    .join('');
}

export function rulesInspectorHtml(ruleset: Ruleset): string {
  return [
    inspectorGroup(
      'Match',
      [
        inspectorRow(
          ruleset.name,
          `${Math.ceil(ruleset.match.durationTicks / ruleset.tickRate)}s · score ${ruleset.match.scoreLimit}`,
          `teams ${ruleset.match.teams.map((team) => team.name).join(', ')} · friendly fire ${ruleset.match.friendlyFire ? 'on' : 'off'}`,
          '#f5f3ed',
        ),
      ],
    ),
    inspectorGroup(
      'Objectives',
      ruleset.objectives.map((objective) =>
        inspectorRow(
          objective.name,
          `${objective.kind} · ${objective.scoreZones.length} zones`,
          objective.scoreZones.map((zone) => `${zone.team} +${zone.points} at ${zone.x}, ${zone.y}`).join(' · '),
          objective.body.color,
        ),
      ),
    ),
    inspectorGroup(
      'Abilities',
      ruleset.abilities.map((ability) => inspectorRow(ability.name, abilityMeta(ability), abilityDetail(ability), ability.color)),
    ),
    inspectorGroup(
      'Statuses',
      ruleset.mechanics.statuses.map((status) =>
        inspectorRow(
          status.name,
          [`${status.durationTicks} ticks`, ...(status.tags ?? [])].join(' · '),
          [
            status.movementMultiplier === undefined ? undefined : `move x${status.movementMultiplier}`,
            status.damageDealtMultiplier === undefined ? undefined : `deal x${status.damageDealtMultiplier}`,
            status.damageTakenMultiplier === undefined ? undefined : `taken x${status.damageTakenMultiplier}`,
            status.periodic ? `periodic ${status.periodic.everyTicks}` : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || 'marker',
          status.color,
        ),
      ),
    ),
    inspectorGroup(
      'Resources',
      ruleset.mechanics.resources.map((resource) =>
        inspectorRow(resource.name, `${resource.start}/${resource.max}`, `regen ${resource.regenPerTick}`, resource.color),
      ),
    ),
    inspectorGroup(
      'Triggers',
      ruleset.mechanics.triggers.map((trigger) => inspectorRow(trigger.name ?? trigger.id, trigger.event, triggerDetail(trigger), '#ffe66d')),
    ),
    inspectorGroup(
      'NPCs',
      ruleset.npcs.archetypes.map((archetype) =>
        inspectorRow(
          archetype.name,
          `${archetype.id} · ${archetype.behavior.mode} · team ${archetype.team}`,
          `loadout ${archetype.loadout.abilityIds.join(', ') || 'none'} · cast ${archetype.casting.slots.map((slot) => slot + 1).join(', ') || 'none'} · x${archetype.hpMultiplier} hp`,
          `hsl(${archetype.hue} 76% 58%)`,
        ),
      ),
    ),
    inspectorGroup(
      'NPC Spawns',
      [
        ...ruleset.npcs.labSpawns.map((spawn) =>
          inspectorRow(spawn.id, `lab · ${spawn.archetypeId}`, `${spawn.x}, ${spawn.y}${spawn.team ? ` · team ${spawn.team}` : ''}`, '#2fd17c'),
        ),
        ...ruleset.npcs.sessionSpawns.map((spawn) =>
          inspectorRow(spawn.id, `session · ${spawn.archetypeId}`, `${spawn.x}, ${spawn.y}${spawn.team ? ` · team ${spawn.team}` : ''}`, '#ff6b4a'),
        ),
      ],
    ),
  ].join('');
}

export function mechanicsChipHtml(label: string, value: string, color: string): string {
  return `<span class="mechanic-chip" style="--chip-color:${escapeHtml(color)}"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(value)}</small></span>`;
}

export function traceLabel(trace: MechanicTraceSnapshot): string {
  const source = trace.sourceName ?? shortTraceId(trace.sourceId) ?? 'system';
  const target = trace.targetName ?? shortTraceId(trace.targetId);
  const ability = trace.abilityName ?? trace.abilityId;
  if (trace.kind === 'physics') {
    return `${trace.tick} physics ${trace.physicsKind ?? 'event'} ${ability ? `via ${ability}` : ''}${target ? ` ${source}->${target}` : ` ${source}`}`.trim();
  }
  if (trace.kind === 'event') {
    const objective = trace.objectiveName ?? trace.objectiveId;
    const scored = trace.scoringTeamId ? ` team ${trace.scoringTeamId}` : '';
    return `${trace.tick} ${trace.event ?? 'event'} ${objective ? objective : ability ? `via ${ability}` : ''}${scored} ${target ? `${source}->${target}` : source}`.trim();
  }
  if (trace.kind === 'trigger') {
    return `${trace.tick} trigger ${trace.triggerName ?? trace.triggerId ?? 'unknown'} fired`;
  }
  if (trace.kind === 'condition-failed') {
    return `${trace.tick} skip ${trace.triggerName ?? trace.triggerId ?? 'trigger'}: ${trace.conditionKind ?? 'condition'}`;
  }
  if (trace.kind === 'action') {
    return `${trace.tick} action ${trace.actionKind ?? 'action'}${trace.statusId ? ` ${trace.statusId}` : ''}${trace.resourceId ? ` ${trace.resourceId}` : ''}${trace.amount === undefined ? '' : ` ${Math.round(trace.amount)}`}`;
  }
  return `${trace.tick} mechanics guard blocked queued events`;
}

export function aiTraceLabel(trace: AiTraceSnapshot): string {
  const actor = trace.actorName ?? shortTraceId(trace.actorId) ?? 'npc';
  const target = trace.targetName ?? shortTraceId(trace.targetId);
  if (trace.kind === 'target') {
    return `${trace.tick} ai ${actor} ${trace.result === 'acquired' ? `target ${target ?? 'enemy'}` : trace.reason ?? 'no target'}`;
  }
  if (trace.kind === 'move') {
    return `${trace.tick} ai ${actor} ${trace.behavior ?? 'move'}${target ? ` toward ${target}` : ''}`;
  }
  if (trace.kind === 'cast') {
    return `${trace.tick} ai ${actor} cast ${trace.abilityId ?? `slot ${trace.slot ?? 0}`}${target ? ` at ${target}` : ''}`;
  }
  return `${trace.tick} ai ${actor} blocked ${trace.abilityId ?? `slot ${trace.slot ?? 0}`}: ${trace.reason ?? 'blocked'}`;
}

export function formatMeters(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '--';
  }
  return `${value.toFixed(2)}m`;
}

function inspectorGroup(title: string, rows: string[]): string {
  const body = rows.length > 0 ? rows.join('') : '<div class="inspector-empty">None</div>';
  return `<section class="inspector-group"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function inspectorRow(title: string, meta: string, detail: string, color: string): string {
  return `
    <div class="inspector-row">
      <span class="inspector-swatch" style="--swatch:${escapeHtml(color)}"></span>
      <span class="inspector-row__main">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(meta)}</small>
        <small>${escapeHtml(detail)}</small>
      </span>
    </div>
  `;
}

function abilityMeta(ability: Ruleset['abilities'][number]): string {
  return [
    ability.shape,
    ability.targeting,
    ability.shape === 'projectile' && ability.worldCollision === 'phase' ? 'phase walls' : undefined,
    ...(ability.tags ?? []),
  ]
    .filter(Boolean)
    .join(' · ');
}

function abilityDetail(ability: Ruleset['abilities'][number]): string {
  const physicsEffects = (ability.effects ?? []).map(physicsEffectLabel).filter(Boolean);
  return [
    `${ability.damage} dmg`,
    `${ability.cooldownTicks} cd`,
    `${(ability.effects ?? []).length} effects`,
    physicsEffects.length > 0 ? physicsEffects.join(', ') : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function physicsEffectLabel(effect: NonNullable<Ruleset['abilities'][number]['effects']>[number]): string | undefined {
  if (effect.kind === 'spawnBody') {
    return `body r${effect.body.radius}`;
  }
  if (effect.kind === 'snare') {
    return `snare ${effect.radius}`;
  }
  if (effect.kind === 'dragBody') {
    return `drag ${effect.leashLength}`;
  }
  return undefined;
}

function triggerDetail(trigger: Ruleset['mechanics']['triggers'][number]): string {
  const conditions = trigger.conditions?.map(conditionLabel).join(' + ') ?? 'always';
  const actions = trigger.actions.map(actionLabel).join(' + ');
  return `${conditions} -> ${actions}`;
}

function conditionLabel(condition: MechanicCondition): string {
  if (condition.kind === 'hasStatus' || condition.kind === 'missingStatus') {
    return `${condition.target} ${condition.kind} ${condition.statusId}`;
  }
  if (condition.kind === 'hpBelow') {
    return `${condition.target} hp < ${Math.round(condition.ratio * 100)}%`;
  }
  if (condition.kind === 'resourceAtLeast') {
    return `${condition.target} ${condition.resourceId} >= ${condition.amount}`;
  }
  if (condition.kind === 'slotUsed') {
    return `slot ${condition.slot + 1}`;
  }
  if (condition.kind === 'objectiveId') {
    return `objective ${condition.objectiveId}`;
  }
  if (condition.kind === 'scoringTeam') {
    return `team ${condition.teamId}`;
  }
  return `tag ${condition.tag}`;
}

function actionLabel(action: MechanicAction): string {
  if (action.kind === 'applyStatus' || action.kind === 'removeStatus') {
    return `${action.kind} ${action.statusId}`;
  }
  if (action.kind === 'modifyResource') {
    return `${action.resourceId} ${action.amount > 0 ? '+' : ''}${action.amount}`;
  }
  if (action.kind === 'dealDamage' || action.kind === 'heal') {
    return `${action.kind} ${action.amount}`;
  }
  if (action.kind === 'knockback') {
    return `knockback ${action.force}`;
  }
  if (action.kind === 'slow') {
    return `slow x${action.multiplier}`;
  }
  return `flash ${action.radius}`;
}

function shortTraceId(value: string | undefined): string | undefined {
  return value ? value.slice(-8) : undefined;
}
