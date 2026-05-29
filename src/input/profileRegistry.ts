/**
 * Per-profile behaviour registry.
 *
 * Single source of truth for *runtime behaviour* tied to a profile id:
 * which input overrides compose, how the on-screen joystick is constrained,
 * what role the right pad plays (aim+fire vs tank steering), whether the
 * canvas captures pointer-to-world taps, etc.
 *
 * Adding a new profile should be a single declarative entry here plus a
 * widget-layout entry in `profiles.ts`. `app.ts` and `InputController` should
 * read from this registry instead of branching on profile-id string literals.
 *
 * Kept separate from `UiProfile` (widget visibility / scale / handedness),
 * which describes *appearance*. This file describes *behaviour wiring*.
 */

import type { PlayerAimMode, PlayerMovementMode } from '../engine/protocol';
import type { UiProfileId } from './profiles';

/** Ordered list of override functions to apply to the per-tick PlayerInput. */
export type OverrideKey = 'single-stick-tank' | 'tap-move' | 'tap-fire';

/** Visual + mechanical constraint applied to the left-side movement pad. */
export type JoystickConstraint =
  | 'none'           // analog 360-degree stick
  | 'tank-steering'  // forward/back only (Y axis); X locked
  | 'cardinal';      // dominant-axis lock (4-way gate)

/**
 * Role of the right-side pad. `'aim-and-fire'` is the standard mmo-touch
 * pattern (drag to aim, release to fire slot 0). `'tank-steer'` repurposes
 * the same widget as a horizontal steering pad — it contributes to moveX
 * instead of aim and never queues a cast.
 */
export type FirePadRole = 'aim-and-fire' | 'tank-steer';

/** How canvas pointer events are interpreted, if at all. */
export type PointerWorldMode =
  | 'none'        // canvas pointer events flow through to InputController as normal
  | 'tap-target'  // tap sets a world target consumed by `tap-move` override
  | 'tap-fire';   // tap = one-shot fire; hold = charge slot 0

export type ProfileBehavior = {
  readonly id: UiProfileId;
  readonly label: string;
  readonly overrides: readonly OverrideKey[];
  readonly joystickConstraint: JoystickConstraint;
  readonly firePadRole: FirePadRole;
  readonly pointerWorldMode: PointerWorldMode;
  readonly disablesMouseAim: boolean;
  readonly hintText?: string;
  readonly compatibleMovementModes: readonly PlayerMovementMode[];
  readonly compatibleAimModes: readonly PlayerAimMode[];
};

const NONE: readonly OverrideKey[] = Object.freeze([]);
const ALL_AIM_MODES: readonly PlayerAimMode[] = Object.freeze(['free', 'facing']);
const ALL_MOVEMENT_MODES: readonly PlayerMovementMode[] = Object.freeze(['twinStick', 'tank', 'platform', 'orthogonal']);
const FREE_AIM_ONLY: readonly PlayerAimMode[] = Object.freeze(['free']);
const TWIN_STICK_ONLY: readonly PlayerMovementMode[] = Object.freeze(['twinStick']);
const TWIN_STICK_AND_TANK: readonly PlayerMovementMode[] = Object.freeze(['twinStick', 'tank']);
const TWIN_STICK_AND_PLATFORM: readonly PlayerMovementMode[] = Object.freeze(['twinStick', 'platform']);
const TWIN_STICK_AND_ORTHOGONAL: readonly PlayerMovementMode[] = Object.freeze(['twinStick', 'orthogonal']);

const BEHAVIORS: Readonly<Record<Exclude<UiProfileId, 'custom'>, ProfileBehavior>> = Object.freeze({
  'desktop-kbm': {
    id: 'desktop-kbm',
    label: 'Keyboard + mouse',
    overrides: NONE,
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'none',
    disablesMouseAim: false,
    compatibleMovementModes: ALL_MOVEMENT_MODES,
    compatibleAimModes: ALL_AIM_MODES,
  },
  'mmo-touch': {
    id: 'mmo-touch',
    label: 'Touch: stick + fire',
    overrides: NONE,
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'none',
    disablesMouseAim: false,
    compatibleMovementModes: TWIN_STICK_ONLY,
    compatibleAimModes: FREE_AIM_ONLY,
  },
  'tap-move': {
    id: 'tap-move',
    label: 'Tap to move',
    overrides: Object.freeze(['tap-move']) as readonly OverrideKey[],
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'tap-target',
    disablesMouseAim: false,
    hintText: 'Tap to move',
    compatibleMovementModes: ALL_MOVEMENT_MODES,
    compatibleAimModes: ALL_AIM_MODES,
  },
  'tap-fire': {
    id: 'tap-fire',
    label: 'Tap to fire',
    overrides: Object.freeze(['tap-fire']) as readonly OverrideKey[],
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'tap-fire',
    disablesMouseAim: true,
    hintText: 'Tap to fire',
    compatibleMovementModes: ALL_MOVEMENT_MODES,
    compatibleAimModes: FREE_AIM_ONLY,
  },
  'tank-touch': {
    id: 'tank-touch',
    label: 'Tank touch',
    overrides: NONE,
    joystickConstraint: 'tank-steering',
    firePadRole: 'tank-steer',
    pointerWorldMode: 'none',
    disablesMouseAim: false,
    compatibleMovementModes: TWIN_STICK_AND_TANK,
    compatibleAimModes: ALL_AIM_MODES,
  },
  'tank-single': {
    id: 'tank-single',
    label: 'Touch: single tank stick',
    overrides: Object.freeze(['single-stick-tank']) as readonly OverrideKey[],
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'none',
    disablesMouseAim: false,
    compatibleMovementModes: TWIN_STICK_AND_TANK,
    compatibleAimModes: ALL_AIM_MODES,
  },
  'tank-single-tap': {
    id: 'tank-single-tap',
    label: 'Touch: single tank stick tap to fire',
    overrides: Object.freeze(['single-stick-tank', 'tap-fire']) as readonly OverrideKey[],
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'tap-fire',
    disablesMouseAim: true,
    hintText: 'Tap to fire',
    compatibleMovementModes: TWIN_STICK_AND_TANK,
    compatibleAimModes: FREE_AIM_ONLY,
  },
  'platform-touch': {
    id: 'platform-touch',
    label: 'Platform touch',
    overrides: NONE,
    joystickConstraint: 'none',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'none',
    disablesMouseAim: false,
    compatibleMovementModes: TWIN_STICK_AND_PLATFORM,
    compatibleAimModes: ALL_AIM_MODES,
  },
  'orthogonal-touch': {
    id: 'orthogonal-touch',
    label: 'Touch: orthogonal stick',
    overrides: NONE,
    joystickConstraint: 'cardinal',
    firePadRole: 'aim-and-fire',
    pointerWorldMode: 'none',
    disablesMouseAim: false,
    compatibleMovementModes: TWIN_STICK_AND_ORTHOGONAL,
    compatibleAimModes: ALL_AIM_MODES,
  },
});

/** Behaviour used for the 'custom' profile slot. Mirrors mmo-touch. */
const CUSTOM_BEHAVIOR: ProfileBehavior = Object.freeze({
  ...BEHAVIORS['mmo-touch'],
  id: 'custom' as UiProfileId,
  label: 'Custom',
});

export function getProfileBehavior(id: UiProfileId): ProfileBehavior {
  if (id === 'custom') return CUSTOM_BEHAVIOR;
  return BEHAVIORS[id];
}

type RulesShape = { movement: PlayerMovementMode; aim: PlayerAimMode };

export function isProfileCompatibleWithRules(profile: UiProfileId, rules: RulesShape): boolean {
  if (profile === 'custom') {
    return true;
  }
  const behavior = BEHAVIORS[profile];
  return behavior.compatibleMovementModes.includes(rules.movement) && behavior.compatibleAimModes.includes(rules.aim);
}

export function coerceProfileToRules(profile: UiProfileId, rules: RulesShape): UiProfileId {
  if (isProfileCompatibleWithRules(profile, rules)) {
    return profile;
  }
  if (rules.movement === 'platform') {
    return 'platform-touch';
  }
  if (rules.movement === 'tank') {
    return 'tank-touch';
  }
  if (rules.aim === 'facing') {
    return 'tank-touch';
  }
  if (rules.movement === 'orthogonal') {
    return 'orthogonal-touch';
  }
  return profile;
}

export function getControlProfileOptions(): ReadonlyArray<{ value: UiProfileId; label: string }> {
  const builtin = (Object.values(BEHAVIORS) as ProfileBehavior[]).map((b) => ({
    value: b.id,
    label: b.label,
  }));
  return [...builtin, { value: 'custom' as UiProfileId, label: CUSTOM_BEHAVIOR.label }];
}

/** Test helper: returns just the builtin ids in declaration order. */
export function listBuiltinBehaviorIds(): readonly UiProfileId[] {
  return (Object.values(BEHAVIORS) as ProfileBehavior[]).map((b) => b.id);
}
