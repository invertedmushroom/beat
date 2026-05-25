import { rulesetFingerprint } from '../../engine/rulesHash';
import { stringifyRuleset, validateRuleset } from '../../engine/rulesValidation';
import type { Ruleset } from '../../engine/protocol';
import { diagnosticsFromError, type WorkbenchDiagnostic } from './fields';
import type { WorkbenchEditorState } from './state';

export type WorkbenchDocument = {
  schemaVersion: 1;
  rules: Ruleset;
  editor?: WorkbenchEditorState;
};

export type WorkbenchParseResult = {
  ruleset: Ruleset;
  editor?: WorkbenchEditorState;
  wrapped: boolean;
};

export type WorkbenchValidationResult =
  | { ok: true; ruleset: Ruleset; diagnostics: WorkbenchDiagnostic[] }
  | { ok: false; diagnostics: WorkbenchDiagnostic[] };

export function parseWorkbenchDocumentJson(json: string): WorkbenchParseResult {
  const parsed = JSON.parse(json) as unknown;
  return parseWorkbenchDocument(parsed);
}

export function parseWorkbenchDocument(value: unknown): WorkbenchParseResult {
  if (isWorkbenchDocumentLike(value)) {
    return {
      ruleset: validateRuleset(value.rules),
      editor: isRecord(value.editor) ? readEditorState(value.editor) : undefined,
      wrapped: true,
    };
  }
  return {
    ruleset: validateRuleset(value),
    wrapped: false,
  };
}

export function validateWorkbenchRules(value: unknown): WorkbenchValidationResult {
  try {
    return { ok: true, ruleset: parseWorkbenchDocument(value).ruleset, diagnostics: [] };
  } catch (error) {
    return { ok: false, diagnostics: diagnosticsFromError(error) };
  }
}

export function stringifyRulesDocument(ruleset: Ruleset): string {
  return stringifyRuleset(ruleset);
}

export function stringifyWorkbenchDocument(ruleset: Ruleset, editor?: WorkbenchEditorState): string {
  const document: WorkbenchDocument = {
    schemaVersion: 1,
    rules: ruleset,
    editor,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function workbenchRulesFingerprint(document: WorkbenchDocument | Ruleset): string {
  return rulesetFingerprint(isWorkbenchDocumentLike(document) ? validateRuleset(document.rules) : validateRuleset(document));
}

function isWorkbenchDocumentLike(value: unknown): value is { schemaVersion: 1; rules: unknown; editor?: unknown } {
  return isRecord(value) && value.schemaVersion === 1 && 'rules' in value;
}

function readEditorState(value: Record<string, unknown>): WorkbenchEditorState {
  return {
    selectedTab: typeof value.selectedTab === 'string' ? value.selectedTab as WorkbenchEditorState['selectedTab'] : undefined,
    selectedAbilityId: typeof value.selectedAbilityId === 'string' ? value.selectedAbilityId : undefined,
    selectedAbilityEffectIndex: typeof value.selectedAbilityEffectIndex === 'number' ? value.selectedAbilityEffectIndex : undefined,
    selectedTriggerId: typeof value.selectedTriggerId === 'string' ? value.selectedTriggerId : undefined,
    selectedTriggerConditionIndex: typeof value.selectedTriggerConditionIndex === 'number' ? value.selectedTriggerConditionIndex : undefined,
    selectedTriggerActionIndex: typeof value.selectedTriggerActionIndex === 'number' ? value.selectedTriggerActionIndex : undefined,
    selectedNpcId: typeof value.selectedNpcId === 'string' ? value.selectedNpcId : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
