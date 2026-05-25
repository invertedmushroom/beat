import { describe, expect, it } from 'vitest';
import { defaultUiPreferences, loadUiPreferences, parseUiPreferences, saveUiPreferences, UI_PREFERENCES_KEY } from './preferences';
import { createDefaultRuleset } from '../engine/defaultRules';
import { rulesetFingerprint } from '../engine/rulesHash';

describe('ui preferences', () => {
  it('clamps and defaults local preference values', () => {
    expect(
      parseUiPreferences({
        hudScale: 9,
        skillBarPosition: 'corner',
        touchHandedness: 'left',
        touchScale: 0.1,
        touchOpacity: 0.01,
        traceDefaultOpen: true,
        hudDensity: 'compact',
      }),
    ).toEqual({
      ...defaultUiPreferences(),
      hudScale: 1.35,
      touchHandedness: 'left',
      touchScale: 0.75,
      touchOpacity: 0.25,
      traceDefaultOpen: true,
      hudDensity: 'compact',
    });
  });

  it('saves and loads from storage without touching the rules fingerprint', () => {
    const storage = new MemoryStorage();
    const ruleset = createDefaultRuleset();
    const before = rulesetFingerprint(ruleset);

    saveUiPreferences({ ...defaultUiPreferences(), hudScale: 1.2, skillBarPosition: 'right' }, storage);

    expect(storage.getItem(UI_PREFERENCES_KEY)).toContain('right');
    expect(loadUiPreferences(storage).hudScale).toBe(1.2);
    expect(rulesetFingerprint(ruleset)).toBe(before);
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
