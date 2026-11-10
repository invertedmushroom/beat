import { bench, describe } from 'vitest';
import type { EngineSnapshot } from '../engine/protocol';
import { createDefaultRuleset } from '../engine/defaultRules';
import { prepareSnapshot, SnapshotEncoder } from './snapshotCodec';

const rules = createDefaultRuleset();
const state: EngineSnapshot = {
  tick: 0, nowMs: 0, rulesetId: rules.id,
  match: { elapsedTicks: 0, remainingTicks: 1000, durationTicks: 1000, scoreLimit: 10, finished: false, teams: [] },
  players: [], objectives: [], physicsBodies: [], constraints: [], effects: [], combatTexts: [], mechanicTraces: [], aiTraces: [],
  projectiles: Array.from({ length: 400 }, (_, i) => ({ projectileId: `shot_${i}`, ownerId: 'p0', abilityId: 'shot', x: i / 100, y: 2, radius: 0.2, color: '#ff0000' })),
};
const peers = Array.from({ length: 8 }, () => new SnapshotEncoder(rules.arena, 60));

describe('busy snapshot encoding: 8 peers, 400 projectiles', () => {
  bench('broadcast preparation and peer deltas', () => {
    state.tick++;
    state.nowMs += 50;
    for (const projectile of state.projectiles) projectile.x += 0.00001;
    const prepared = prepareSnapshot(state, rules.arena);
    for (const peer of peers) {
      peer.encodePrepared(prepared);
      peer.acknowledge(state.tick);
    }
  }, { time: 500, warmupTime: 100 });
});
