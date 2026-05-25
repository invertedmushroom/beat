import type { AbilityEffect, Ruleset } from '../../engine/protocol';
import type { WorkbenchState, WorkbenchTab } from './state';

export type WorkbenchFieldKind = 'rules' | 'ability' | 'trigger' | 'npc' | 'team' | 'objective' | 'scoreZone';
export type WorkbenchFieldInput = 'text' | 'number' | 'checkbox' | 'select' | 'color';

export type WorkbenchField = {
  id: string;
  label: string;
  section: WorkbenchTab;
  kind: WorkbenchFieldKind;
  path: string;
  controlId: string;
  input: WorkbenchFieldInput;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  visibleWhen?: { fieldId: 'movementMode'; equals: Ruleset['player']['movement']['mode'] };
};

export type WorkbenchDiagnostic = {
  path: string;
  severity: 'error' | 'warning';
  message: string;
};

export type WorkbenchFieldEdit =
  | { kind: 'rules'; fieldId: string; value: string; checked?: boolean }
  | { kind: 'loadout'; slot: number; value: string }
  | { kind: 'ability'; fieldId: string; value: string }
  | { kind: 'abilityEffect'; effectIndex: number; fieldId: string; value: string }
  | { kind: 'abilityEffectKind'; effectIndex: number; value: string }
  | { kind: 'trigger'; fieldId: string; value: string }
  | { kind: 'mechanicCondition'; conditionIndex: number; fieldId: string; value: string }
  | { kind: 'mechanicConditionKind'; conditionIndex: number; value: string }
  | { kind: 'mechanicAction'; actionIndex: number; fieldId: string; value: string }
  | { kind: 'mechanicActionKind'; actionIndex: number; value: string }
  | { kind: 'npc'; fieldId: string; value: string; checked?: boolean }
  | { kind: 'team'; fieldId: string; value: string }
  | { kind: 'objective'; fieldId: string; value: string; checked?: boolean }
  | { kind: 'scoreZone'; fieldId: string; value: string };

export type WorkbenchCommand =
  | { kind: 'abilityEffect'; command: 'add' | 'remove' | 'moveUp' | 'moveDown'; effectIndex?: number; effectKind?: AbilityEffect['kind'] }
  | { kind: 'mechanicCondition'; command: 'add' | 'remove' | 'moveUp' | 'moveDown'; conditionIndex?: number }
  | { kind: 'mechanicAction'; command: 'add' | 'remove' | 'moveUp' | 'moveDown'; actionIndex?: number }
  | { kind: 'scoreZone'; command: 'add' | 'duplicate' | 'remove'; scoreZoneId?: string };

export type WorkbenchFieldApplier = (ruleset: Ruleset, state: WorkbenchState, edit: WorkbenchFieldEdit) => boolean;
