import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_IDS, type UiProfileId } from './profiles';
import {
  coerceProfileToRules,
  getControlProfileOptions,
  getProfileBehavior,
  isProfileCompatibleWithRules,
  listBuiltinBehaviorIds,
} from './profileRegistry';

describe('profile registry', () => {
  it('declares a behavior for every builtin profile id', () => {
    for (const id of BUILTIN_PROFILE_IDS) {
      const behavior = getProfileBehavior(id);
      expect(behavior.id).toBe(id);
      expect(behavior.label.length).toBeGreaterThan(0);
    }
  });

  it('builtin behavior list matches profiles.BUILTIN_PROFILE_IDS', () => {
    expect([...listBuiltinBehaviorIds()].sort()).toEqual([...BUILTIN_PROFILE_IDS].sort());
  });

  it('control-profile options include every builtin plus custom', () => {
    const ids = getControlProfileOptions().map((o) => o.value);
    for (const id of BUILTIN_PROFILE_IDS) expect(ids).toContain(id);
    expect(ids).toContain('custom' as UiProfileId);
  });

  it('tank-touch is the only profile with the tank-steer fire-pad role', () => {
    const tankSteer = BUILTIN_PROFILE_IDS.filter(
      (id) => getProfileBehavior(id).firePadRole === 'tank-steer',
    );
    expect(tankSteer).toEqual(['tank-touch']);
  });

  it('tank-touch has tank-steering joystick constraint', () => {
    expect(getProfileBehavior('tank-touch').joystickConstraint).toBe('tank-steering');
  });

  it('orthogonal-touch has cardinal joystick constraint', () => {
    expect(getProfileBehavior('orthogonal-touch').joystickConstraint).toBe('cardinal');
  });

  it('tap-fire and tank-single-tap both use the tap-fire pointer-world mode', () => {
    expect(getProfileBehavior('tap-fire').pointerWorldMode).toBe('tap-fire');
    expect(getProfileBehavior('tank-single-tap').pointerWorldMode).toBe('tap-fire');
  });

  it('tap-move uses the tap-target pointer-world mode', () => {
    expect(getProfileBehavior('tap-move').pointerWorldMode).toBe('tap-target');
  });

  it('only tap-fire-style profiles disable mouse aim', () => {
    const disablesMouse = BUILTIN_PROFILE_IDS.filter(
      (id) => getProfileBehavior(id).disablesMouseAim,
    );
    expect(disablesMouse.sort()).toEqual(['tank-single-tap', 'tap-fire'].sort());
  });

  it('treats mmo-touch as only coherent under twin-stick free aim', () => {
    expect(isProfileCompatibleWithRules('mmo-touch', { movement: 'twinStick', aim: 'free' })).toBe(true);
    expect(isProfileCompatibleWithRules('mmo-touch', { movement: 'tank', aim: 'free' })).toBe(false);
    expect(isProfileCompatibleWithRules('mmo-touch', { movement: 'twinStick', aim: 'facing' })).toBe(false);
  });

  it('keeps tap-fire compatible with all movement modes but not facing aim', () => {
    expect(isProfileCompatibleWithRules('tap-fire', { movement: 'platform', aim: 'free' })).toBe(true);
    expect(isProfileCompatibleWithRules('tap-fire', { movement: 'orthogonal', aim: 'free' })).toBe(true);
    expect(isProfileCompatibleWithRules('tap-fire', { movement: 'tank', aim: 'facing' })).toBe(false);
  });

  it('coerces incompatible profiles to the expected rules-aware fallbacks', () => {
    expect(coerceProfileToRules('mmo-touch', { movement: 'platform', aim: 'free' })).toBe('platform-touch');
    expect(coerceProfileToRules('mmo-touch', { movement: 'tank', aim: 'free' })).toBe('tank-touch');
    expect(coerceProfileToRules('mmo-touch', { movement: 'orthogonal', aim: 'free' })).toBe('orthogonal-touch');
    expect(coerceProfileToRules('tank-single-tap', { movement: 'tank', aim: 'facing' })).toBe('tank-touch');
  });

  it('tank-single-tap composes single-stick-tank then tap-fire', () => {
    expect([...getProfileBehavior('tank-single-tap').overrides]).toEqual([
      'single-stick-tank',
      'tap-fire',
    ]);
  });

  it('tank-single composes only single-stick-tank', () => {
    expect([...getProfileBehavior('tank-single').overrides]).toEqual(['single-stick-tank']);
  });

  it('tap-move composes only tap-move override', () => {
    expect([...getProfileBehavior('tap-move').overrides]).toEqual(['tap-move']);
  });

  it('tap-fire composes only tap-fire override', () => {
    expect([...getProfileBehavior('tap-fire').overrides]).toEqual(['tap-fire']);
  });

  it('profiles without overrides declare an empty overrides array', () => {
    for (const id of ['desktop-kbm', 'mmo-touch', 'tank-touch', 'platform-touch', 'orthogonal-touch'] as const) {
      expect(getProfileBehavior(id).overrides.length).toBe(0);
    }
  });

  it('hintText is set exactly for tap-driven profiles', () => {
    const withHint = BUILTIN_PROFILE_IDS.filter((id) => getProfileBehavior(id).hintText);
    expect(withHint.sort()).toEqual(['tank-single-tap', 'tap-fire', 'tap-move'].sort());
  });

  it('custom profile mirrors mmo-touch behavior but labels itself Custom', () => {
    const custom = getProfileBehavior('custom');
    const mmo = getProfileBehavior('mmo-touch');
    expect(custom.id).toBe('custom');
    expect(custom.label).toBe('Custom');
    expect(custom.firePadRole).toBe(mmo.firePadRole);
    expect(custom.joystickConstraint).toBe(mmo.joystickConstraint);
    expect(custom.pointerWorldMode).toBe(mmo.pointerWorldMode);
    expect(custom.disablesMouseAim).toBe(mmo.disablesMouseAim);
  });
});
