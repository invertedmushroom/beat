import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../../engine/defaultRules';
import { rulesetFingerprint } from '../../engine/rulesHash';
import { parseWorkbenchDocumentJson, stringifyRulesDocument, stringifyWorkbenchDocument, workbenchRulesFingerprint } from './jsonSync';

describe('workbench json sync', () => {
  it('imports bare rules and exports canonical bare rules by default', () => {
    const ruleset = createDefaultRuleset();
    const parsed = parseWorkbenchDocumentJson(JSON.stringify(ruleset));

    expect(parsed.wrapped).toBe(false);
    expect(parsed.ruleset).toEqual(ruleset);
    expect(JSON.parse(stringifyRulesDocument(parsed.ruleset))).toEqual(ruleset);
  });

  it('imports wrapped documents and keeps editor metadata separate from rules', () => {
    const ruleset = createDefaultRuleset();
    const wrapped = stringifyWorkbenchDocument(ruleset, {
      selectedTab: 'npcs',
      selectedAbilityId: 'pulse-bolt',
    });
    const parsed = parseWorkbenchDocumentJson(wrapped);

    expect(parsed.wrapped).toBe(true);
    expect(parsed.editor).toMatchObject({ selectedTab: 'npcs', selectedAbilityId: 'pulse-bolt' });
    expect(parsed.ruleset).toEqual(ruleset);
  });

  it('excludes editor metadata from rules fingerprints', () => {
    const ruleset = createDefaultRuleset();
    const wrappedA = { schemaVersion: 1 as const, rules: ruleset, editor: { selectedTab: 'player' as const } };
    const wrappedB = { schemaVersion: 1 as const, rules: ruleset, editor: { selectedTab: 'advanced' as const, selectedNpcId: 'spark-chaser' } };

    expect(workbenchRulesFingerprint(wrappedA)).toBe(workbenchRulesFingerprint(wrappedB));
    expect(workbenchRulesFingerprint(wrappedA)).toBe(rulesetFingerprint(ruleset));
  });
});
