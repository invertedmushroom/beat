/**
 * Curated control profiles for the local ergonomics layer.
 *
 * Phase 1 scaffolding: these presets describe widget layout and intent for
 * the future profile-driven control system. No code yet consumes them at
 * runtime; `InputController` still owns all widget wiring. The presets are
 * exported so Phase 2 can split `InputController` into a profile resolver +
 * widget layer + input mapper without re-litigating the design.
 *
 * See `docs/control-ergonomics-plan.md` for the rationale.
 */

import type { PlayerAimMode, PlayerMovementMode } from '../engine/protocol';
import type { CapabilityBucket, InputCapabilities } from './capabilities';

export type UiProfileId =
  | 'desktop-kbm'
  | 'mmo-touch'
  | 'tap-move'
  | 'tap-fire'
  | 'tank-touch'
  | 'platform-touch'
  | 'custom';

export type MovementWidget = 'leftStick' | 'tapMove' | 'leftRightButtons' | 'keyboard';
export type AimWidget = 'firePad' | 'facingOnly' | 'skillDragOnly' | 'mouse';
export type SkillBarLayout = 'bottom' | 'left' | 'right' | 'cluster-right';
export type HintVerbosity = 'auto' | 'minimal' | 'verbose';
export type Handedness = 'left' | 'right';

export type UiProfile = {
  id: UiProfileId;
  movementWidget: MovementWidget;
  aimWidget: AimWidget;
  showFirePad: boolean;
  showMovePad: boolean;
  showJumpButton: boolean;
  skillBarLayout: SkillBarLayout;
  widgetScale: number;
  widgetOpacity: number;
  handedness: Handedness;
  hints: HintVerbosity;
};

const BUILTIN_PROFILES: Readonly<Record<Exclude<UiProfileId, 'custom'>, UiProfile>> = Object.freeze({
  'desktop-kbm': {
    id: 'desktop-kbm',
    movementWidget: 'keyboard',
    aimWidget: 'mouse',
    showFirePad: false,
    showMovePad: false,
    showJumpButton: false,
    skillBarLayout: 'bottom',
    widgetScale: 1,
    widgetOpacity: 1,
    handedness: 'right',
    hints: 'auto',
  },
  'mmo-touch': {
    id: 'mmo-touch',
    movementWidget: 'leftStick',
    aimWidget: 'firePad',
    showFirePad: true,
    showMovePad: true,
    showJumpButton: false,
    skillBarLayout: 'cluster-right',
    widgetScale: 1,
    widgetOpacity: 0.88,
    handedness: 'right',
    hints: 'auto',
  },
  'tap-move': {
    id: 'tap-move',
    movementWidget: 'tapMove',
    aimWidget: 'skillDragOnly',
    showFirePad: false,
    showMovePad: false,
    showJumpButton: false,
    skillBarLayout: 'cluster-right',
    widgetScale: 1.1,
    widgetOpacity: 0.88,
    handedness: 'right',
    hints: 'auto',
  },
  'tap-fire': {
    id: 'tap-fire',
    movementWidget: 'leftStick',
    aimWidget: 'skillDragOnly',
    showFirePad: false,
    showMovePad: true,
    showJumpButton: false,
    skillBarLayout: 'cluster-right',
    widgetScale: 1,
    widgetOpacity: 0.88,
    handedness: 'right',
    hints: 'auto',
  },
  'tank-touch': {
    id: 'tank-touch',
    movementWidget: 'leftStick',
    aimWidget: 'facingOnly',
    showFirePad: false,
    showMovePad: true,
    showJumpButton: false,
    skillBarLayout: 'cluster-right',
    widgetScale: 1,
    widgetOpacity: 0.88,
    handedness: 'right',
    hints: 'auto',
  },
  'platform-touch': {
    id: 'platform-touch',
    movementWidget: 'leftRightButtons',
    aimWidget: 'skillDragOnly',
    showFirePad: false,
    showMovePad: false,
    showJumpButton: true,
    skillBarLayout: 'cluster-right',
    widgetScale: 1,
    widgetOpacity: 0.88,
    handedness: 'right',
    hints: 'auto',
  },
});

export const BUILTIN_PROFILE_IDS: readonly Exclude<UiProfileId, 'custom'>[] = Object.freeze([
  'desktop-kbm',
  'mmo-touch',
  'tap-move',
  'tap-fire',
  'tank-touch',
  'platform-touch',
]);

export function getBuiltinProfile(id: Exclude<UiProfileId, 'custom'>): UiProfile {
  return { ...BUILTIN_PROFILES[id] };
}

export function defaultCustomProfile(): UiProfile {
  return { ...BUILTIN_PROFILES['mmo-touch'], id: 'custom' };
}

/**
 * Recommended preset per capability bucket. Chosen so the same user gets a
 * sensible default on each device class without locking them in.
 */
export function defaultProfileForBucket(bucket: CapabilityBucket): UiProfileId {
  switch (bucket) {
    case 'fine-only':
      return 'desktop-kbm';
    case 'coarse-only':
      return 'mmo-touch';
    case 'hybrid':
      return 'desktop-kbm';
    case 'none':
    default:
      return 'desktop-kbm';
  }
}

export function defaultProfileForCapabilities(capabilities: InputCapabilities): UiProfileId {
  return defaultProfileForBucket(capabilities.bucket);
}

/**
 * Rules-aware adjustment: a saved profile may not match the active ruleset
 * (e.g. user picked `mmo-touch` but the rules say `movement=platform`).
 * Returns a profile id that is at least *coherent* with the rules, while
 * preserving the user's choice when it already fits.
 *
 * Pure function so it can be unit-tested without DOM.
 */
export function adaptProfileToRules(
  profile: UiProfileId,
  rules: { movement: PlayerMovementMode; aim: PlayerAimMode },
): UiProfileId {
  if (profile === 'custom') return profile;
  if (rules.movement === 'platform' && profile !== 'platform-touch' && profile !== 'desktop-kbm') {
    return 'platform-touch';
  }
  if (rules.movement === 'tank' && profile !== 'tank-touch' && profile !== 'desktop-kbm') {
    return 'tank-touch';
  }
  if (rules.aim === 'facing' && (profile === 'mmo-touch' || profile === 'tap-fire')) {
    return 'tank-touch';
  }
  return profile;
}
