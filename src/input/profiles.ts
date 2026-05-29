/**
 * Curated control-profile presentation data.
 *
 * This file is the visual/layout half of the ergonomics system: which widgets
 * exist, whether they are shown, and their display-related defaults. Runtime
 * behavior now lives in `profileRegistry.ts`, which decides override
 * composition, pad constraints, pointer-world ownership, and mouse-aim
 * policy. The split keeps appearance and behavior independently testable.
 *
 * `adaptProfileToRules()` remains here as the public compatibility entry-point,
 * but the compatibility metadata now lives in `profileRegistry.ts` alongside
 * other per-profile behavior.
 */

import type { PlayerAimMode, PlayerMovementMode } from '../engine/protocol';
import type { CapabilityBucket, InputCapabilities } from './capabilities';
import { coerceProfileToRules } from './profileRegistry';

export type UiProfileId =
  | 'desktop-kbm'
  | 'mmo-touch'
  | 'tap-move'
  | 'tap-fire'
  | 'tank-touch'
  | 'tank-single'
  | 'tank-single-tap'
  | 'platform-touch'
  | 'orthogonal-touch'
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
    showFirePad: true,
    showMovePad: true,
    showJumpButton: false,
    skillBarLayout: 'cluster-right',
    widgetScale: 1,
    widgetOpacity: 0.88,
    handedness: 'right',
    hints: 'auto',
  },
  'tank-single': {
    id: 'tank-single',
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
  'tank-single-tap': {
    id: 'tank-single-tap',
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
  'orthogonal-touch': {
    id: 'orthogonal-touch',
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
});

export const BUILTIN_PROFILE_IDS: readonly Exclude<UiProfileId, 'custom'>[] = Object.freeze([
  'desktop-kbm',
  'mmo-touch',
  'tap-move',
  'tap-fire',
  'tank-touch',
  'tank-single',
  'tank-single-tap',
  'platform-touch',
  'orthogonal-touch',
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
  return coerceProfileToRules(profile, rules);
}
