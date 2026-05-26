import { describe, expect, it } from 'vitest';
import {
  adaptProfileToRules,
  BUILTIN_PROFILE_IDS,
  defaultCustomProfile,
  defaultProfileForBucket,
  defaultProfileForCapabilities,
  getBuiltinProfile,
} from './profiles';

describe('profile presets', () => {
  it('exposes the four curated presets plus desktop default', () => {
    expect(BUILTIN_PROFILE_IDS).toContain('desktop-kbm');
    expect(BUILTIN_PROFILE_IDS).toContain('mmo-touch');
    expect(BUILTIN_PROFILE_IDS).toContain('tap-move');
    expect(BUILTIN_PROFILE_IDS).toContain('tap-fire');
    expect(BUILTIN_PROFILE_IDS).toContain('tank-touch');
    expect(BUILTIN_PROFILE_IDS).toContain('platform-touch');
  });

  it('returns immutable preset copies', () => {
    const a = getBuiltinProfile('mmo-touch');
    const b = getBuiltinProfile('mmo-touch');
    a.widgetScale = 9;
    expect(b.widgetScale).not.toBe(9);
  });

  it('custom profile defaults from mmo-touch but reports id=custom', () => {
    expect(defaultCustomProfile().id).toBe('custom');
  });
});

describe('defaultProfileForBucket', () => {
  it('picks desktop-kbm for fine-only and hybrid', () => {
    expect(defaultProfileForBucket('fine-only')).toBe('desktop-kbm');
    expect(defaultProfileForBucket('hybrid')).toBe('desktop-kbm');
  });

  it('picks mmo-touch for coarse-only', () => {
    expect(defaultProfileForBucket('coarse-only')).toBe('mmo-touch');
  });
});

describe('defaultProfileForCapabilities', () => {
  it('delegates to bucket-based default', () => {
    expect(
      defaultProfileForCapabilities({
        primaryPointer: 'coarse',
        anyFinePointer: false,
        anyCoarsePointer: true,
        maxTouchPoints: 5,
        bucket: 'coarse-only',
      }),
    ).toBe('mmo-touch');
  });
});

describe('adaptProfileToRules', () => {
  it('forces platform-touch when rules say platform', () => {
    expect(adaptProfileToRules('mmo-touch', { movement: 'platform', aim: 'free' })).toBe('platform-touch');
  });

  it('forces tank-touch when rules say tank', () => {
    expect(adaptProfileToRules('mmo-touch', { movement: 'tank', aim: 'facing' })).toBe('tank-touch');
  });

  it('switches mmo-touch to tank-touch when aim mode is facing', () => {
    expect(adaptProfileToRules('mmo-touch', { movement: 'twinStick', aim: 'facing' })).toBe('tank-touch');
  });

  it('switches tap-fire to tank-touch when aim mode is facing', () => {
    expect(adaptProfileToRules('tap-fire', { movement: 'twinStick', aim: 'facing' })).toBe('tank-touch');
  });

  it('forces tap-fire to platform-touch under platform rules', () => {
    expect(adaptProfileToRules('tap-fire', { movement: 'platform', aim: 'free' })).toBe('platform-touch');
  });

  it('passes tap-fire through when rules already match', () => {
    expect(adaptProfileToRules('tap-fire', { movement: 'twinStick', aim: 'free' })).toBe('tap-fire');
  });

  it('preserves desktop-kbm regardless of rules', () => {
    expect(adaptProfileToRules('desktop-kbm', { movement: 'platform', aim: 'free' })).toBe('desktop-kbm');
    expect(adaptProfileToRules('desktop-kbm', { movement: 'tank', aim: 'facing' })).toBe('desktop-kbm');
  });

  it('preserves custom profile', () => {
    expect(adaptProfileToRules('custom', { movement: 'platform', aim: 'free' })).toBe('custom');
  });

  it('passes through when profile already matches rules', () => {
    expect(adaptProfileToRules('platform-touch', { movement: 'platform', aim: 'free' })).toBe('platform-touch');
    expect(adaptProfileToRules('tap-move', { movement: 'twinStick', aim: 'free' })).toBe('tap-move');
  });
});
