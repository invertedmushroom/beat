import type { Ruleset } from '../../engine/protocol';

export type WorkbenchTab =
  | 'match'
  | 'player'
  | 'abilities'
  | 'mechanics'
  | 'npcs'
  | 'physics'
  | 'presets'
  | 'preferences'
  | 'advanced';

export type WorkbenchEditorState = {
  selectedTab?: WorkbenchTab;
  selectedAbilityId?: string;
  selectedTriggerId?: string;
  selectedNpcId?: string;
};

export type WorkbenchState = {
  selectedTab: WorkbenchTab;
  selectedAbilityId: string;
  selectedTriggerId: string;
  selectedNpcId: string;
  draftRuleset: Ruleset;
};

export const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string }> = [
  { id: 'match', label: 'Match' },
  { id: 'player', label: 'Player' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'mechanics', label: 'Mechanics' },
  { id: 'npcs', label: 'NPCs' },
  { id: 'physics', label: 'Physics' },
  { id: 'presets', label: 'Presets' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'advanced', label: 'Advanced JSON' },
];

const WORKBENCH_TAB_IDS = new Set<WorkbenchTab>(WORKBENCH_TABS.map((tab) => tab.id));

export function isWorkbenchTab(value: string): value is WorkbenchTab {
  return WORKBENCH_TAB_IDS.has(value as WorkbenchTab);
}

export function createWorkbenchState(ruleset: Ruleset, editor: WorkbenchEditorState = {}): WorkbenchState {
  const state: WorkbenchState = {
    selectedTab: editor.selectedTab && isWorkbenchTab(editor.selectedTab) ? editor.selectedTab : 'player',
    selectedAbilityId: editor.selectedAbilityId ?? '',
    selectedTriggerId: editor.selectedTriggerId ?? '',
    selectedNpcId: editor.selectedNpcId ?? '',
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
  state.selectedTriggerId = ruleset.mechanics.triggers.some((trigger) => trigger.id === state.selectedTriggerId)
    ? state.selectedTriggerId
    : (ruleset.mechanics.triggers[0]?.id ?? '');
  state.selectedNpcId = ruleset.npcs.archetypes.some((npc) => npc.id === state.selectedNpcId)
    ? state.selectedNpcId
    : (ruleset.npcs.archetypes[0]?.id ?? '');
}

export function updateWorkbenchDraft(state: WorkbenchState, ruleset: Ruleset): void {
  state.draftRuleset = ruleset;
  ensureWorkbenchSelections(state, ruleset);
}

export function toWorkbenchEditorState(state: WorkbenchState): WorkbenchEditorState {
  return {
    selectedTab: state.selectedTab,
    selectedAbilityId: state.selectedAbilityId || undefined,
    selectedTriggerId: state.selectedTriggerId || undefined,
    selectedNpcId: state.selectedNpcId || undefined,
  };
}
