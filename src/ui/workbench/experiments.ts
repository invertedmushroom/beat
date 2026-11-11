import { createDefaultRuleset, defaultDeathmatchObjective, defaultKingZoneObjective } from '../../engine/defaultRules';
import type { Ruleset } from '../../engine/protocol';
import { validateRuleset } from '../../engine/rulesValidation';

export const MECHANIC_PRESETS = [
  { id: 'combos', name: 'Combo Mechanics', description: 'Statuses, resources, and hit-triggered combos.' },
  { id: 'bleed-dot', name: 'Bleed Over Time', description: 'Add a bleeding status to Arc Slash in your current rules.' },
  { id: 'execute', name: 'Low HP Execute', description: 'Add bonus hit damage against targets below 30% HP.' },
] as const;

/** Complete examples replace rules; small mechanics experiments extend the current rules. */
export const EXPERIMENTS = [
  { id: 'combo-preset', name: 'Combo Mechanics', description: 'Statuses, resources, and hit-triggered combos.', detail: '2–6 players · Relic Push', kind: 'Complete rules', build: createDefaultRuleset },
  { id: 'physics-preset', name: 'Physics Playground', description: 'Snare rivals, spawn orbs, and drag a tethered weight.', detail: '2–6 players · Physics toys', kind: 'Complete rules', build: physicsRules },
  { id: 'platform-preset', name: 'Platform Arena', description: 'Jump between ledges with gravity and air control.', detail: '2–6 players · Ledges & gravity', kind: 'Complete rules', build: platformRules },
  { id: 'deathmatch-preset', name: 'Deathmatch + Combos', description: 'Score points on every elimination in a four-pillar arena.', detail: '2–6 players · First to 10 kills', kind: 'Complete rules', build: deathmatchRules },
  { id: 'duel-preset', name: 'Duel + Combos', description: 'Two-player elimination duel with combo triggers active.', detail: '2 players · First to 5 kills', kind: 'Complete rules', build: duelRules },
  { id: 'king-zone-preset', name: 'Hill + Combos', description: 'Hold the central hill to score points over time.', detail: '2–6 players · First to 30 points', kind: 'Complete rules', build: hillRules },
  { id: 'bleed-dot', name: 'Bleed Over Time', description: 'Add a bleeding status to Arc Slash in your current rules.', detail: 'Status addon', kind: 'Adds to current rules', build: bleedRules },
  { id: 'execute', name: 'Low HP Execute', description: 'Add bonus hit damage against targets below 30% HP.', detail: 'Trigger addon', kind: 'Adds to current rules', build: executeRules },
] as const;

export type MechanicPresetId = typeof MECHANIC_PRESETS[number]['id'];
export type ExperimentAddonId = 'bleed-dot' | 'execute';
export type CompleteExperimentId = Exclude<typeof EXPERIMENTS[number]['id'], ExperimentAddonId>;

const COMBO_TRIGGER_IDS = new Set([
  'shock-bonus',
  'chill-shatter',
  'spark-shield',
  'shield-cushion',
  'lance-heat',
  'heated-lance-pop',
  'relic-score-flash',
]);

export function isCompleteExperimentId(value: string): value is CompleteExperimentId {
  return EXPERIMENTS.some((entry) => entry.id === value && entry.kind === 'Complete rules');
}

export function isExperimentAddonId(value: string): value is ExperimentAddonId {
  return value === 'bleed-dot' || value === 'execute';
}

export function isMechanicPresetId(value: string): value is MechanicPresetId {
  return MECHANIC_PRESETS.some((entry) => entry.id === value);
}

export function isMechanicPresetEnabled(rules: Ruleset, id: MechanicPresetId): boolean {
  if (id === 'combos') {
    return rules.mechanics.triggers.some((trigger) => COMBO_TRIGGER_IDS.has(trigger.id));
  }
  if (id === 'bleed-dot') {
    return rules.mechanics.statuses.some((status) => status.id === 'bleeding');
  }
  return rules.mechanics.triggers.some((trigger) => trigger.id === 'low-hp-execute');
}

export function toggleMechanicPreset(current: Ruleset, id: MechanicPresetId, enabled: boolean): Ruleset {
  const rules = structuredClone(current);
  if (id === 'combos') {
    toggleCombos(rules, enabled);
  } else if (id === 'bleed-dot') {
    toggleBleed(rules, enabled);
  } else {
    toggleExecute(rules, enabled);
  }
  return validateRuleset(rules);
}

export function applyExperiment(current: Ruleset, id: string): Ruleset {
  const experiment = EXPERIMENTS.find((entry) => entry.id === id);
  if (!experiment) throw new Error('Choose an experiment from the library.');
  return validateRuleset(experiment.build(structuredClone(current)));
}

function physicsRules(): Ruleset {
  const rules = createDefaultRuleset();
  rules.loadout.abilityIds = ['anchor-orb', 'wrecking-weight', 'seeker-spark', 'ion-lance'];
  return rules;
}

function deathmatchRules(): Ruleset {
  const rules = createDefaultRuleset();
  rules.id = 'beat-deathmatch';
  rules.name = 'Beat Deathmatch';
  rules.match.scoreLimit = 10;
  rules.objectives = [defaultDeathmatchObjective('center-relic')];
  return rules;
}

function duelRules(): Ruleset {
  const rules = deathmatchRules();
  rules.id = 'beat-duel';
  rules.name = 'Beat Duel';
  rules.maxPlayers = 2;
  rules.match.scoreLimit = 5;
  rules.match.friendlyFire = true;
  return rules;
}

function hillRules(): Ruleset {
  const rules = createDefaultRuleset();
  rules.id = 'beat-king-zone';
  rules.name = 'Beat King Zone';
  rules.match.scoreLimit = 30;
  rules.objectives = [defaultKingZoneObjective('center-relic')];
  return rules;
}

function platformRules(): Ruleset {
  const rules = createDefaultRuleset();
  rules.id = 'beat-platform-lab';
  rules.name = 'Beat Platform Lab';
  rules.player.damping = 0.35;
  rules.player.speed = 7.2;
  rules.player.movement.mode = 'platform';
  rules.player.movement.platform = { gravity: 30, jumpVelocity: 12, airControl: 0.48, maxFallSpeed: 20, groundProbeDistance: 0.1 };
  rules.obstacles = [
    { id: 'floor', x: 0, y: 9.2, halfWidth: 18, halfHeight: 0.8 },
    { id: 'bottom-left', x: -11, y: 5.2, halfWidth: 0.8, halfHeight: 0.25 },
    { id: 'bottom-left_center', x: -6.5, y: 7.2, halfWidth: 0.8, halfHeight: 0.25 },
    { id: 'bottom-right', x: 11, y: 5.2, halfWidth: 0.8, halfHeight: 0.25 },
    { id: 'bottom-right_center', x: 6.5, y: 7.2, halfWidth: 0.8, halfHeight: 0.25 },
    { id: 'lower-center', x: 0, y: 3.8, halfWidth: 6.2, halfHeight: 0.35 },
    { id: 'mid-left', x: -8.2, y: 0.2, halfWidth: 3.4, halfHeight: 0.35 },
    { id: 'mid-right', x: 8.2, y: 0.2, halfWidth: 3.4, halfHeight: 0.35 },
    { id: 'top-left', x: -10.5, y: -3.8, halfWidth: 3.4, halfHeight: 0.35 },
    { id: 'top-right', x: 10.5, y: -3.8, halfWidth: 3.4, halfHeight: 0.35 },
    { id: 'top-platform', x: 0, y: -6.8, halfWidth: 5.8, halfHeight: 0.35 },
  ];
  const relic = rules.objectives[0];
  if (relic.kind === 'relicPush') {
    relic.spawn = { x: 0, y: -7.2 };
    relic.scoreZones = [
      { id: 'players-goal', team: 'players', x: 12, y: 8, radius: 2.45, points: 1, color: '#2fd17c' },
      { id: 'hostile-goal', team: 'hostile', x: -12, y: 8, radius: 2.45, points: 1, color: '#ff6b4a' },
    ];
  }
  rules.loadout.abilityIds = ['pulse-bolt', 'anchor-orb', 'seeker-spark', 'ion-lance'];
  return rules;
}

function bleedRules(rules: Ruleset): Ruleset {
  upsertById(rules.mechanics.statuses, {
    id: 'bleeding', name: 'Bleeding', color: '#e0524d', durationTicks: 120, tags: ['bleed'],
    periodic: { everyTicks: 24, actions: [{ kind: 'dealDamage', target: 'target', amount: 4, color: '#e0524d' }] },
  });
  const slash = rules.abilities.find((ability) => ability.id === 'arc-slash');
  if (slash) {
    slash.effects = [...(slash.effects ?? []).filter((effect) => effect.kind !== 'applyStatus' || effect.statusId !== 'bleeding'), { kind: 'applyStatus', target: 'hit', statusId: 'bleeding' }];
    slash.tags = Array.from(new Set([...(slash.tags ?? []), 'bleed']));
  }
  return rules;
}

function executeRules(rules: Ruleset): Ruleset {
  upsertById(rules.mechanics.triggers, {
    id: 'low-hp-execute', name: 'Low HP Execute', event: 'onHit',
    conditions: [{ kind: 'hpBelow', target: 'target', ratio: 0.3 }],
    actions: [
      { kind: 'dealDamage', target: 'target', amount: 16, color: '#ffffff' },
      { kind: 'flashEffect', target: 'target', radius: 1.8, color: '#ffffff' },
    ],
  });
  return rules;
}

function toggleCombos(rules: Ruleset, enabled: boolean): void {
  if (!enabled) {
    rules.mechanics.triggers = rules.mechanics.triggers.filter((trigger) => !COMBO_TRIGGER_IDS.has(trigger.id));
    pruneUnusedComboDefinitions(rules);
    return;
  }
  const defaults = createDefaultRuleset();
  for (const status of defaults.mechanics.statuses) upsertById(rules.mechanics.statuses, status);
  for (const resource of defaults.mechanics.resources) upsertById(rules.mechanics.resources, resource);
  const primaryObjectiveId = rules.objectives[0]?.id;
  for (const trigger of defaults.mechanics.triggers) {
    if (trigger.id === 'relic-score-flash') {
      if (!primaryObjectiveId) continue;
      trigger.conditions = [{ kind: 'objectiveId', objectiveId: primaryObjectiveId }];
    }
    upsertById(rules.mechanics.triggers, trigger);
  }
}

function pruneUnusedComboDefinitions(rules: Ruleset): void {
  const usedResources = new Set<string>();
  const usedStatuses = new Set<string>();
  for (const ability of rules.abilities) {
    for (const effect of ability.effects ?? []) {
      if (effect.kind === 'applyStatus') usedStatuses.add(effect.statusId);
    }
  }
  for (const trigger of rules.mechanics.triggers) {
    for (const condition of trigger.conditions ?? []) {
      if (condition.kind === 'resourceAtLeast') usedResources.add(condition.resourceId);
      if (condition.kind === 'hasStatus' || condition.kind === 'missingStatus') usedStatuses.add(condition.statusId);
    }
    for (const action of trigger.actions) {
      if (action.kind === 'modifyResource') usedResources.add(action.resourceId);
      if (action.kind === 'applyStatus' || action.kind === 'removeStatus') usedStatuses.add(action.statusId);
    }
  }
  rules.mechanics.resources = rules.mechanics.resources.filter((res) => usedResources.has(res.id));
  rules.mechanics.statuses = rules.mechanics.statuses.filter((status) => status.id !== 'overheated' || usedStatuses.has(status.id));
}

function toggleBleed(rules: Ruleset, enabled: boolean): void {
  if (enabled) {
    bleedRules(rules);
    return;
  }
  const slash = rules.abilities.find((ability) => ability.id === 'arc-slash');
  if (slash) {
    slash.effects = (slash.effects ?? []).filter((effect) => !(effect.kind === 'applyStatus' && effect.statusId === 'bleeding'));
    if (slash.effects.length === 0) delete slash.effects;
    slash.tags = (slash.tags ?? []).filter((tag) => tag !== 'bleed');
    if (slash.tags.length === 0) delete slash.tags;
  }
  const stillReferenced = rules.mechanics.triggers.some(
    (trigger) =>
      (trigger.conditions ?? []).some((c) => (c.kind === 'hasStatus' || c.kind === 'missingStatus') && c.statusId === 'bleeding') ||
      trigger.actions.some((a) => (a.kind === 'applyStatus' || a.kind === 'removeStatus') && a.statusId === 'bleeding'),
  );
  if (!stillReferenced) {
    rules.mechanics.statuses = rules.mechanics.statuses.filter((status) => status.id !== 'bleeding');
  }
}

function toggleExecute(rules: Ruleset, enabled: boolean): void {
  if (enabled) {
    executeRules(rules);
    return;
  }
  rules.mechanics.triggers = rules.mechanics.triggers.filter((trigger) => trigger.id !== 'low-hp-execute');
}

function upsertById<T extends { id: string }>(values: T[], value: T): void {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  if (index >= 0) values[index] = value;
  else values.push(value);
}
