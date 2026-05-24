import type { EngineSnapshot } from '../engine/protocol';

export type NetworkSnapshot = Omit<EngineSnapshot, 'mechanicTraces' | 'aiTraces'>;

export function toNetworkSnapshot(snapshot: EngineSnapshot): NetworkSnapshot {
  const networkSnapshot: Partial<EngineSnapshot> = { ...snapshot };
  delete networkSnapshot.mechanicTraces;
  delete networkSnapshot.aiTraces;
  return networkSnapshot as NetworkSnapshot;
}

export function fromNetworkSnapshot(snapshot: NetworkSnapshot): EngineSnapshot {
  return {
    ...snapshot,
    mechanicTraces: [],
    aiTraces: [],
  };
}

export function estimateSnapshotBytes(snapshot: NetworkSnapshot | EngineSnapshot): number {
  return JSON.stringify(snapshot).length;
}
