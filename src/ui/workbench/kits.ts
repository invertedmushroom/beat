import { createDefaultRuleset, defaultDeathmatchObjective, defaultKingZoneObjective, defaultRelicPushObjective } from '../../engine/defaultRules';
import type { RelicPushObjective, Ruleset } from '../../engine/protocol';
import { validateRuleset } from '../../engine/rulesValidation';
import {
  applyExperiment,
  isCompleteExperimentId,
  isExperimentAddonId,
  toggleMechanicPreset,
  type CompleteExperimentId,
  type ExperimentAddonId,
} from './experiments';

export const MATCH_KITS = [
  { id: 'duel', name: 'Duel', description: 'Three pillars, two rivals. First to 5 kills.', detail: '2 players · 3 minutes' },
  { id: 'hill', name: 'King of the Hill', description: 'Hold the open center. First team to 30 points.', detail: '2–6 players · 3 minutes' },
  { id: 'relic', name: 'Relic Push', description: 'Push the ball into your team’s colored goal. First to 3.', detail: '2–6 players · 3 minutes' },
] as const;

export const MOVEMENT_CHASSIS = [
  { id: 'twin', name: 'Twin Stick', description: 'Quick stops and independent aim.', speed: 8.2, damping: 9, mode: 'twinStick', aim: 'free' },
  { id: 'tank', name: 'Heavy Tank', description: 'Turn to aim; reverse to retreat.', speed: 6.8, damping: 8, mode: 'tank', aim: 'facing' },
  { id: 'four-way', name: 'Four-Way', description: 'Move on four axes and aim where you travel.', speed: 7.8, damping: 10, mode: 'orthogonal', aim: 'facing' },
  { id: 'platform', name: 'Platform', description: 'Gravity, jump velocity, and air control.', speed: 7.2, damping: 0.35, mode: 'platform', aim: 'free' },
] as const;

export const ABILITY_CARDS = [
  { id: 'pulse-bolt', name: 'Pulse Bolt', tag: 'Knockback', description: 'Fast bolt that pushes rivals and the ball back.' },
  { id: 'arc-slash', name: 'Arc Slash', tag: 'Control', description: 'Aim-assisted melee sweep that chills rivals.' },
  { id: 'seeker-spark', name: 'Seeker Spark', tag: 'Sustain', description: 'Aim-assisted shot; casting heals you.' },
  { id: 'ion-lance', name: 'Ion Lance', tag: 'Burst / Mobility', description: 'Hold to charge a powerful shot; release to dash.' },
  { id: 'blink-step', name: 'Blink Step', tag: 'Mobility', description: 'Short-cooldown phase step that vaults you forward.' },
  { id: 'heavy-cleave', name: 'Heavy Cleave', tag: 'Zone Control', description: 'Wide sweeping cleave that knocks back and slows.' },
  { id: 'repulsor-wave', name: 'Repulsor Wave', tag: '360° Peel', description: 'Radial shockwave that launches nearby rivals and the ball.' },
  { id: 'rail-snipe', name: 'Rail Snipe', tag: 'Long-Range Burst', description: 'High-velocity charged shot with heavy knockback.' },
  { id: 'anchor-orb', name: 'Anchor Orb', tag: 'Control', description: 'Snare a rival and leave a heavy orb at impact.' },
  { id: 'wrecking-weight', name: 'Wrecking Weight', tag: 'Physics', description: 'Drag a heavy weight behind you on a tether.' },
] as const;

export const MUTATOR_CHIPS = [
  { id: 'turbo', name: 'Turbo Cooldowns', description: 'Cooldowns ×0.4' },
  { id: 'giant', name: 'Giant Projectiles', description: 'Projectile hit radius ×1.5' },
  { id: 'pinball', name: 'Strong Knockback', description: 'Ability knockback ×2.5' },
] as const;

export type MatchKitId = typeof MATCH_KITS[number]['id'];
export type ChassisId = typeof MOVEMENT_CHASSIS[number]['id'];
export type AbilityCardId = typeof ABILITY_CARDS[number]['id'];
export type MutatorId = typeof MUTATOR_CHIPS[number]['id'];
export type KitSelection = {
  match: MatchKitId;
  experiment?: CompleteExperimentId;
  combos?: boolean;
  addons?: ExperimentAddonId[];
  chassis: ChassisId;
  abilities: [AbilityCardId, AbilityCardId, AbilityCardId, AbilityCardId];
  mutators: MutatorId[];
  bouncyRelic: boolean;
};

const MATCH_LOADOUTS: Record<MatchKitId, [AbilityCardId, AbilityCardId, AbilityCardId, AbilityCardId]> = {
  duel: ['pulse-bolt', 'arc-slash', 'blink-step', 'ion-lance'],
  hill: ['heavy-cleave', 'repulsor-wave', 'seeker-spark', 'anchor-orb'],
  relic: ['pulse-bolt', 'repulsor-wave', 'blink-step', 'rail-snipe'],
};

const EXPERIMENT_DEFAULTS: Record<
  CompleteExperimentId,
  { match: MatchKitId; chassis: ChassisId; abilities: [AbilityCardId, AbilityCardId, AbilityCardId, AbilityCardId] }
> = {
  'combo-preset': { match: 'relic', chassis: 'twin', abilities: ['pulse-bolt', 'arc-slash', 'seeker-spark', 'ion-lance'] },
  'physics-preset': { match: 'relic', chassis: 'twin', abilities: ['anchor-orb', 'wrecking-weight', 'repulsor-wave', 'rail-snipe'] },
  'platform-preset': { match: 'relic', chassis: 'platform', abilities: ['blink-step', 'pulse-bolt', 'anchor-orb', 'rail-snipe'] },
  'deathmatch-preset': { match: 'duel', chassis: 'twin', abilities: ['pulse-bolt', 'heavy-cleave', 'seeker-spark', 'ion-lance'] },
  'duel-preset': { match: 'duel', chassis: 'twin', abilities: ['pulse-bolt', 'arc-slash', 'blink-step', 'ion-lance'] },
  'king-zone-preset': { match: 'hill', chassis: 'twin', abilities: ['heavy-cleave', 'repulsor-wave', 'seeker-spark', 'ion-lance'] },
};

export function createKitSelection(match: MatchKitId): KitSelection {
  return {
    match,
    chassis: 'twin',
    abilities: [...MATCH_LOADOUTS[match]],
    mutators: [],
    bouncyRelic: false,
  };
}

export function createExperimentSelection(experiment: CompleteExperimentId): KitSelection {
  const defaults = EXPERIMENT_DEFAULTS[experiment];
  return {
    match: defaults.match,
    experiment,
    combos: true,
    addons: [],
    chassis: defaults.chassis,
    abilities: [...defaults.abilities],
    mutators: [],
    bouncyRelic: false,
  };
}

export function withExperimentSelection(current: KitSelection | undefined, experimentId: string): KitSelection | undefined {
  if (isCompleteExperimentId(experimentId)) {
    return createExperimentSelection(experimentId);
  }
  if (!isExperimentAddonId(experimentId) || !current) {
    return undefined;
  }
  const next = structuredClone(current);
  const addons = next.addons ?? [];
  next.addons = addons.includes(experimentId) ? addons.filter((id) => id !== experimentId) : [...addons, experimentId];
  return next;
}

/** Rebuild from catalog values every time. Mutators never modify an earlier result. */
export function compileKit(selection: KitSelection): Ruleset {
  const { match, chassis } = validateSelection(selection);
  if (selection.experiment) {
    return compileExperimentKit(selection, chassis);
  }
  const rules = createDefaultRuleset();
  rules.id = `beat-kit-${match.id}`;
  rules.name = selection.bouncyRelic ? 'Bouncy Relic' : match.name;
  rules.mapBundleId = `kit-${match.id}-arena`;
  rules.contentHash = 'beat-kits';
  rules.match.durationTicks = rules.tickRate * 180;
  applyChassis(rules, chassis);
  // Cards carry their own effects. Omit the default preset's hidden combo bonuses unless toggled.
  rules.mechanics.resources = [];
  rules.mechanics.triggers = [];
  rules.mechanics.statuses = rules.mechanics.statuses.filter((status) => status.id === 'shocked' || status.id === 'chilled');
  rules.loadout.abilityIds = [...selection.abilities];
  rules.npcs.sessionSpawns = [];
  configureMatch(rules, selection);
  return finalizeKitRules(rules, selection, Boolean(selection.combos));
}

function compileExperimentKit(selection: KitSelection, chassis: typeof MOVEMENT_CHASSIS[number]): Ruleset {
  const experiment = selection.experiment!;
  const defaults = EXPERIMENT_DEFAULTS[experiment];
  const rules = applyExperiment(createDefaultRuleset(), experiment);
  if (selection.chassis !== defaults.chassis) {
    applyChassis(rules, chassis);
  }
  rules.loadout.abilityIds = [...selection.abilities];
  if (selection.bouncyRelic) {
    const relic = rules.objectives[0];
    if (relic?.kind !== 'relicPush') throw new Error('Bouncy Relic needs a Relic Push match.');
    applyBouncyRelic(relic);
  }
  return finalizeKitRules(rules, selection, selection.combos ?? true);
}

function finalizeKitRules(rules: Ruleset, selection: KitSelection, combosEnabled: boolean): Ruleset {
  let current = rules;
  if (combosEnabled !== (current.mechanics.triggers.length > 0)) {
    current = toggleMechanicPreset(current, 'combos', combosEnabled);
  }
  for (const addon of selection.addons ?? []) {
    current = toggleMechanicPreset(current, addon, true);
  }
  applyMutators(current, selection.mutators);
  return validateRuleset(current);
}

function applyChassis(rules: Ruleset, chassis: typeof MOVEMENT_CHASSIS[number]): void {
  rules.player.speed = chassis.speed;
  rules.player.damping = chassis.damping;
  rules.player.movement.mode = chassis.mode;
  rules.player.movement.turnSpeedDegrees = 220;
  rules.player.movement.reverseMultiplier = 0.6;
  rules.player.aim.mode = chassis.aim;
}

/** Change movement without replacing the arena, abilities, or authored mechanics. */
export function withMovementPackage(rules: Ruleset, id: ChassisId): Ruleset {
  const chassis = MOVEMENT_CHASSIS.find((entry) => entry.id === id);
  if (!chassis) throw new Error('Choose a movement package.');
  const next = structuredClone(rules);
  applyChassis(next, chassis);
  return validateRuleset(next);
}

function validateSelection(selection: KitSelection) {
  const match = MATCH_KITS.find((kit) => kit.id === selection.match);
  const chassis = MOVEMENT_CHASSIS.find((kit) => kit.id === selection.chassis);
  if (!match || !chassis) throw new Error('Choose a match and movement package.');
  if (selection.experiment !== undefined && !isCompleteExperimentId(selection.experiment)) {
    throw new Error('Choose a valid experiment preset.');
  }
  if ((selection.addons ?? []).some((addon) => !isExperimentAddonId(addon))) {
    throw new Error('Choose catalog mechanic addons.');
  }
  if (selection.abilities.length !== 4 || selection.abilities.some((id) => !ABILITY_CARDS.some((card) => card.id === id))) {
    throw new Error('Choose a match, movement package, and four catalog abilities.');
  }
  if (selection.mutators.some((id) => !MUTATOR_CHIPS.some((chip) => chip.id === id))) throw new Error('Choose catalog mutators.');
  const supportsBouncyRelic = selection.experiment
    ? EXPERIMENT_DEFAULTS[selection.experiment].match === 'relic'
    : selection.match === 'relic';
  if (selection.bouncyRelic && !supportsBouncyRelic) throw new Error('Bouncy Relic needs a Relic Push match.');
  return { match, chassis };
}

function configureMatch(rules: Ruleset, selection: KitSelection): void {
  rules.maxPlayers = selection.match === 'duel' ? 2 : 6;
  rules.match.friendlyFire = selection.match === 'duel';
  rules.match.scoreLimit = { duel: 5, hill: 30, relic: 3 }[selection.match];
  if (selection.match === 'duel') {
    rules.objectives = [defaultDeathmatchObjective()];
    rules.obstacles = [
      { id: 'center', x: 0, y: 0, halfWidth: 1, halfHeight: 2.2 },
      { id: 'north', x: -5, y: -5, halfWidth: 1.2, halfHeight: 1.2 },
      { id: 'south', x: 5, y: 5, halfWidth: 1.2, halfHeight: 1.2 },
    ];
  } else if (selection.match === 'hill') {
    rules.objectives = [defaultKingZoneObjective()];
    rules.obstacles = [
      { id: 'west', x: -9, y: -3.5, halfWidth: 0.8, halfHeight: 2.8 },
      { id: 'east', x: 9, y: 3.5, halfWidth: 0.8, halfHeight: 2.8 },
    ];
  } else {
    const relic = defaultRelicPushObjective('center-relic');
    if (selection.bouncyRelic) {
      applyBouncyRelic(relic);
    }
    rules.objectives = [relic];
    rules.obstacles = [
      { id: 'north-cover', x: 0, y: -6.5, halfWidth: 3, halfHeight: 0.6 },
      { id: 'south-cover', x: 0, y: 6.5, halfWidth: 3, halfHeight: 0.6 },
    ];
  }
}

function applyBouncyRelic(relic: RelicPushObjective): void {
  relic.body.mass = 6;
  relic.body.friction = 0.05;
  relic.body.restitution = 0.92;
  relic.body.linearDamping = 0.15;
}

function applyMutators(rules: Ruleset, mutators: MutatorId[]): void {
  for (const ability of rules.abilities) {
    if (mutators.includes('turbo')) ability.cooldownTicks = Math.max(1, Math.round(ability.cooldownTicks * 0.4));
    if (mutators.includes('giant') && ability.shape === 'projectile') ability.radius *= 1.5;
    if (mutators.includes('pinball')) {
      for (const effect of ability.effects ?? []) {
        if (effect.kind === 'knockback') effect.force *= 2.5;
      }
    }
  }
}
