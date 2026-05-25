import type { Ruleset } from '../../engine/protocol';

export type WorkbenchTab =
  | 'match'
  | 'player'
  | 'abilities'
  | 'mechanics'
  | 'npcs'
  | 'presets'
  | 'preferences'
  | 'advanced';

export type WorkbenchEditorState = {
  selectedTab?: WorkbenchTab | 'physics';
  selectedAbilityId?: string;
  selectedAbilityEffectIndex?: number;
  selectedTriggerId?: string;
  selectedTriggerConditionIndex?: number;
  selectedTriggerActionIndex?: number;
  selectedNpcId?: string;
  selectedObjectiveId?: string;
  selectedScoreZoneId?: string;
  selectedTeamId?: string;
};

export type WorkbenchState = {
  selectedTab: WorkbenchTab;
  selectedAbilityId: string;
  selectedAbilityEffectIndex: number;
  selectedTriggerId: string;
  selectedTriggerConditionIndex: number;
  selectedTriggerActionIndex: number;
  selectedNpcId: string;
  selectedObjectiveId: string;
  selectedScoreZoneId: string;
  selectedTeamId: string;
  draftRuleset: Ruleset;
};

export const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string }> = [
  { id: 'match', label: 'Match' },
  { id: 'player', label: 'Player' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'mechanics', label: 'Mechanics' },
  { id: 'npcs', label: 'NPCs' },
  { id: 'presets', label: 'Presets' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'advanced', label: 'Advanced JSON' },
];

const WORKBENCH_TAB_IDS = new Set<WorkbenchTab>(WORKBENCH_TABS.map((tab) => tab.id));

export function isWorkbenchTab(value: string): value is WorkbenchTab {
  return WORKBENCH_TAB_IDS.has(value as WorkbenchTab);
}

export function normalizeWorkbenchTab(value: string | undefined): WorkbenchTab | undefined {
  if (value === 'physics') {
    return 'abilities';
  }
  return value && isWorkbenchTab(value) ? value : undefined;
}

export function createWorkbenchState(ruleset: Ruleset, editor: WorkbenchEditorState = {}): WorkbenchState {
  const state: WorkbenchState = {
    selectedTab: normalizeWorkbenchTab(editor.selectedTab) ?? 'player',
    selectedAbilityId: editor.selectedAbilityId ?? '',
    selectedAbilityEffectIndex: editor.selectedAbilityEffectIndex ?? 0,
    selectedTriggerId: editor.selectedTriggerId ?? '',
    selectedTriggerConditionIndex: editor.selectedTriggerConditionIndex ?? 0,
    selectedTriggerActionIndex: editor.selectedTriggerActionIndex ?? 0,
    selectedNpcId: editor.selectedNpcId ?? '',
    selectedObjectiveId: editor.selectedObjectiveId ?? '',
    selectedScoreZoneId: editor.selectedScoreZoneId ?? '',
    selectedTeamId: editor.selectedTeamId ?? '',
    draftRuleset: ruleset,
  };
  ensureWorkbenchSelections(state, ruleset);
  return state;
}

export function ensureWorkbenchSelections(state: WorkbenchState, ruleset: Ruleset = state.draftRuleset): void {
  state.draftRuleset = ruleset;
  state.selectedAbilityId = ruleset.abilities.some((ability) => ability.id === state.selectedAbilityId)
    ? state.selectedAbilityId
    : (ruleset.abilities[0]?.id ?? '');
  const ability = ruleset.abilities.find((candidate) => candidate.id === state.selectedAbilityId);
  state.selectedAbilityEffectIndex = clampIndex(state.selectedAbilityEffectIndex, ability?.effects?.length ?? 0);
  state.selectedTriggerId = ruleset.mechanics.triggers.some((trigger) => trigger.id === state.selectedTriggerId)
    ? state.selectedTriggerId
    : (ruleset.mechanics.triggers[0]?.id ?? '');
  const trigger = ruleset.mechanics.triggers.find((candidate) => candidate.id === state.selectedTriggerId);
  state.selectedTriggerConditionIndex = clampIndex(state.selectedTriggerConditionIndex, trigger?.conditions?.length ?? 0);
  state.selectedTriggerActionIndex = clampIndex(state.selectedTriggerActionIndex, trigger?.actions.length ?? 0);
  state.selectedNpcId = ruleset.npcs.archetypes.some((npc) => npc.id === state.selectedNpcId)
    ? state.selectedNpcId
    : (ruleset.npcs.archetypes[0]?.id ?? '');
  state.selectedObjectiveId = ruleset.objectives.some((objective) => objective.id === state.selectedObjectiveId)
    ? state.selectedObjectiveId
    : (ruleset.objectives[0]?.id ?? '');
  const objective = ruleset.objectives.find((candidate) => candidate.id === state.selectedObjectiveId);
  state.selectedScoreZoneId = objective?.scoreZones.some((zone) => zone.id === state.selectedScoreZoneId)
    ? state.selectedScoreZoneId
    : (objective?.scoreZones[0]?.id ?? '');
  state.selectedTeamId = ruleset.match.teams.some((team) => team.id === state.selectedTeamId)
    ? state.selectedTeamId
    : (ruleset.match.teams[0]?.id ?? '');
}

export function updateWorkbenchDraft(state: WorkbenchState, ruleset: Ruleset): void {
  state.draftRuleset = ruleset;
  ensureWorkbenchSelections(state, ruleset);
}

export function toWorkbenchEditorState(state: WorkbenchState): WorkbenchEditorState {
  return {
    selectedTab: state.selectedTab,
    selectedAbilityId: state.selectedAbilityId || undefined,
    selectedAbilityEffectIndex: state.selectedAbilityEffectIndex,
    selectedTriggerId: state.selectedTriggerId || undefined,
    selectedTriggerConditionIndex: state.selectedTriggerConditionIndex,
    selectedTriggerActionIndex: state.selectedTriggerActionIndex,
    selectedNpcId: state.selectedNpcId || undefined,
    selectedObjectiveId: state.selectedObjectiveId || undefined,
    selectedScoreZoneId: state.selectedScoreZoneId || undefined,
    selectedTeamId: state.selectedTeamId || undefined,
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}
