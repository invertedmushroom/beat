import { describe, expect, it } from 'vitest';
import {
  defaultUiPreferences,
  defaultUiPreferencesV2,
  loadUiPreferences,
  loadUiPreferencesV2,
  migrateV1ToV2,
  parseUiPreferences,
  parseUiPreferencesV2,
  resolveActiveProfileId,
  resolveProfile,
  saveUiPreferences,
  saveUiPreferencesV2,
  UI_PREFERENCES_KEY,
  UI_PREFERENCES_V2_KEY,
} from './preferences';
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

describe('ui preferences v2', () => {
  it('migrates v1 fields into the custom profile and global knobs', () => {
    const v1 = {
      ...defaultUiPreferences(),
      hudScale: 1.25,
      touchHandedness: 'left' as const,
      touchScale: 1.2,
      touchOpacity: 0.5,
      skillBarPosition: 'right' as const,
      traceDefaultOpen: true,
      hudDensity: 'compact' as const,
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.hudScale).toBe(1.25);
    expect(v2.hudDensity).toBe('compact');
    expect(v2.traceDefaultOpen).toBe(true);
    expect(v2.customProfile.handedness).toBe('left');
    expect(v2.customProfile.widgetScale).toBe(1.2);
    expect(v2.customProfile.widgetOpacity).toBe(0.5);
    expect(v2.customProfile.skillBarLayout).toBe('right');
  });

  it('loadUiPreferencesV2 migrates from v1 storage when no v2 blob exists', () => {
    const storage = new MemoryStorage();
    saveUiPreferences({ ...defaultUiPreferences(), hudScale: 1.3, touchHandedness: 'left' }, storage);
    const v2 = loadUiPreferencesV2(storage);
    expect(v2.hudScale).toBe(1.3);
    expect(v2.customProfile.handedness).toBe('left');
  });

  it('loadUiPreferencesV2 prefers v2 blob over v1 when both exist', () => {
    const storage = new MemoryStorage();
    saveUiPreferences({ ...defaultUiPreferences(), hudScale: 1.3 }, storage);
    saveUiPreferencesV2({ ...defaultUiPreferencesV2(), hudScale: 1.1 }, storage);
    expect(loadUiPreferencesV2(storage).hudScale).toBe(1.1);
  });

  it('parseUiPreferencesV2 clamps and defaults invalid values', () => {
    const parsed = parseUiPreferencesV2({
      version: 'wrong',
      hudScale: 9,
      hudDensity: 'bogus',
      traceDefaultOpen: 'yes',
      activeProfileByBucket: { 'coarse-only': 'tap-move', invalid: 'mmo-touch' },
      customProfile: {
        id: 'custom',
        movementWidget: 'leftStick',
        aimWidget: 'firePad',
        showFirePad: true,
        showMovePad: true,
        showJumpButton: false,
        skillBarLayout: 'bottom',
        widgetScale: 9,
        widgetOpacity: 9,
        handedness: 'left',
        hints: 'verbose',
      },
    });
    expect(parsed.version).toBe(2);
    expect(parsed.hudScale).toBe(1.35);
    expect(parsed.hudDensity).toBe('detailed');
    expect(parsed.traceDefaultOpen).toBe(false);
    expect(parsed.activeProfileByBucket['coarse-only']).toBe('tap-move');
    expect((parsed.activeProfileByBucket as Record<string, unknown>).invalid).toBeUndefined();
    expect(parsed.customProfile.widgetScale).toBe(1.35);
    expect(parsed.customProfile.widgetOpacity).toBe(1);
    expect(parsed.customProfile.handedness).toBe('left');
  });

  it('resolveActiveProfileId returns saved choice or capability default', () => {
    const prefs = { ...defaultUiPreferencesV2(), activeProfileByBucket: { 'coarse-only': 'tap-move' as const } };
    expect(resolveActiveProfileId(prefs, 'coarse-only')).toBe('tap-move');
    expect(resolveActiveProfileId(prefs, 'fine-only')).toBe('desktop-kbm');
  });

  it('resolveProfile returns custom blob when id is custom', () => {
    const prefs = defaultUiPreferencesV2();
    prefs.customProfile.widgetScale = 1.2;
    const profile = resolveProfile(prefs, 'custom');
    expect(profile.id).toBe('custom');
    expect(profile.widgetScale).toBe(1.2);
  });

  it('saves v2 without touching v1 storage or the rules fingerprint', () => {
    const storage = new MemoryStorage();
    const before = rulesetFingerprint(createDefaultRuleset());

    saveUiPreferencesV2(defaultUiPreferencesV2(), storage);
    expect(storage.getItem(UI_PREFERENCES_V2_KEY)).not.toBeNull();
    expect(storage.getItem(UI_PREFERENCES_KEY)).toBeNull();
    expect(rulesetFingerprint(createDefaultRuleset())).toBe(before);
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
