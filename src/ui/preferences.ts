import {
  BUILTIN_PROFILE_IDS,
  defaultCustomProfile,
  defaultProfileForBucket,
  getBuiltinProfile,
  type AimWidget,
  type Handedness,
  type HintVerbosity,
  type MovementWidget,
  type SkillBarLayout,
  type UiProfile,
  type UiProfileId,
} from '../input/profiles';
import type { CapabilityBucket } from '../input/capabilities';

export type SkillBarPosition = 'bottom' | 'left' | 'right';
export type TouchHandedness = 'right' | 'left';
export type HudDensity = 'detailed' | 'compact';

export type UiPreferences = {
  hudScale: number;
  skillBarPosition: SkillBarPosition;
  touchHandedness: TouchHandedness;
  touchScale: number;
  touchOpacity: number;
  traceDefaultOpen: boolean;
  hudDensity: HudDensity;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const UI_PREFERENCES_KEY = 'beat.uiPreferences.v1';
export function defaultUiPreferences(): UiPreferences {
  return {
    hudScale: 1,
    skillBarPosition: 'bottom',
    touchHandedness: 'right',
    touchScale: 1,
    touchOpacity: 0.88,
    traceDefaultOpen: false,
    hudDensity: 'detailed',
  };
}

export function loadUiPreferences(storage: StorageLike | undefined = safeLocalStorage()): UiPreferences {
  if (!storage) {
    return defaultUiPreferences();
  }
  const raw = storage.getItem(UI_PREFERENCES_KEY);
  if (!raw) {
    return defaultUiPreferences();
  }
  try {
    return parseUiPreferences(JSON.parse(raw) as unknown);
  } catch {
    return defaultUiPreferences();
  }
}

export function saveUiPreferences(preferences: UiPreferences, storage: StorageLike | undefined = safeLocalStorage()): void {
  storage?.setItem(UI_PREFERENCES_KEY, JSON.stringify(parseUiPreferences(preferences)));
}

export function parseUiPreferences(value: unknown): UiPreferences {
  const defaults = defaultUiPreferences();
  if (!isRecord(value)) {
    return defaults;
  }
  return {
    hudScale: readNumber(value.hudScale, defaults.hudScale, 0.75, 1.35),
    skillBarPosition: readEnum(value.skillBarPosition, ['bottom', 'left', 'right'], defaults.skillBarPosition),
    touchHandedness: readEnum(value.touchHandedness, ['right', 'left'], defaults.touchHandedness),
    touchScale: readNumber(value.touchScale, defaults.touchScale, 0.75, 1.35),
    touchOpacity: readNumber(value.touchOpacity, defaults.touchOpacity, 0.25, 1),
    traceDefaultOpen: typeof value.traceDefaultOpen === 'boolean' ? value.traceDefaultOpen : defaults.traceDefaultOpen,
    hudDensity: readEnum(value.hudDensity, ['detailed', 'compact'], defaults.hudDensity),
  };
}

function safeLocalStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function readEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

// ---------------------------------------------------------------------------
// v2 schema: profile-driven local ergonomics. See docs/control-ergonomics-plan.md
//
// v2 is stored under a separate key so that downgrading the app still works:
// v1 readers ignore v2 data, and `loadUiPreferencesV2` will fall back to v1
// when no v2 blob exists. v1 remains the authoritative source for the legacy
// fields that `BeatApp` still consumes; v2 layers profile state on top.
// ---------------------------------------------------------------------------

export const UI_PREFERENCES_V2_KEY = 'beat.uiPreferences.v2';

export type UiPreferencesV2 = {
  version: 2;
  activeProfileByBucket: Partial<Record<CapabilityBucket, UiProfileId>>;
  customProfile: UiProfile;
  hudScale: number;
  hudDensity: HudDensity;
  traceDefaultOpen: boolean;
  shownHints: Partial<Record<UiProfileId, boolean>>;
};

const VALID_PROFILE_IDS: readonly UiProfileId[] = [...BUILTIN_PROFILE_IDS, 'custom'];
const VALID_BUCKETS: readonly CapabilityBucket[] = ['fine-only', 'coarse-only', 'hybrid', 'none'];

export function defaultUiPreferencesV2(): UiPreferencesV2 {
  return {
    version: 2,
    activeProfileByBucket: {},
    customProfile: defaultCustomProfile(),
    hudScale: 1,
    hudDensity: 'detailed',
    traceDefaultOpen: false,
    shownHints: {},
  };
}

export function loadUiPreferencesV2(storage: StorageLike | undefined = safeLocalStorage()): UiPreferencesV2 {
  if (!storage) {
    return defaultUiPreferencesV2();
  }
  const rawV2 = storage.getItem(UI_PREFERENCES_V2_KEY);
  if (rawV2) {
    try {
      return parseUiPreferencesV2(JSON.parse(rawV2) as unknown);
    } catch {
      // fall through to v1 migration
    }
  }
  const rawV1 = storage.getItem(UI_PREFERENCES_KEY);
  if (rawV1) {
    try {
      return migrateV1ToV2(parseUiPreferences(JSON.parse(rawV1) as unknown));
    } catch {
      return defaultUiPreferencesV2();
    }
  }
  return defaultUiPreferencesV2();
}

export function saveUiPreferencesV2(preferences: UiPreferencesV2, storage: StorageLike | undefined = safeLocalStorage()): void {
  storage?.setItem(UI_PREFERENCES_V2_KEY, JSON.stringify(parseUiPreferencesV2(preferences)));
}

export function parseUiPreferencesV2(value: unknown): UiPreferencesV2 {
  const defaults = defaultUiPreferencesV2();
  if (!isRecord(value)) {
    return defaults;
  }
  return {
    version: 2,
    activeProfileByBucket: parseProfileByBucket(value.activeProfileByBucket),
    customProfile: parseProfile(value.customProfile, defaults.customProfile),
    hudScale: readNumber(value.hudScale, defaults.hudScale, 0.75, 1.35),
    hudDensity: readEnum(value.hudDensity, ['detailed', 'compact'], defaults.hudDensity),
    traceDefaultOpen:
      typeof value.traceDefaultOpen === 'boolean' ? value.traceDefaultOpen : defaults.traceDefaultOpen,
    shownHints: parseShownHints(value.shownHints),
  };
}

/**
 * Folds legacy v1 values into a v2 blob. v1 fields map onto the `custom`
 * profile and the surviving global knobs (hudScale, hudDensity, traceDefaultOpen).
 */
export function migrateV1ToV2(v1: UiPreferences): UiPreferencesV2 {
  const base = defaultUiPreferencesV2();
  return {
    ...base,
    customProfile: {
      ...base.customProfile,
      handedness: v1.touchHandedness === 'left' ? 'left' : 'right',
      widgetScale: v1.touchScale,
      widgetOpacity: v1.touchOpacity,
      skillBarLayout: mapSkillBarLayout(v1.skillBarPosition),
    },
    hudScale: v1.hudScale,
    hudDensity: v1.hudDensity,
    traceDefaultOpen: v1.traceDefaultOpen,
  };
}

/**
 * Returns the profile the user has selected for a given capability bucket,
 * or the recommended default for that bucket if none is set.
 */
export function resolveActiveProfileId(
  preferences: UiPreferencesV2,
  bucket: CapabilityBucket,
): UiProfileId {
  return preferences.activeProfileByBucket[bucket] ?? defaultProfileForBucket(bucket);
}

export function resolveProfile(preferences: UiPreferencesV2, id: UiProfileId): UiProfile {
  if (id === 'custom') return { ...preferences.customProfile, id: 'custom' };
  return getBuiltinProfile(id);
}

function mapSkillBarLayout(position: SkillBarPosition): SkillBarLayout {
  switch (position) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'bottom':
    default:
      return 'bottom';
  }
}

function parseProfileByBucket(value: unknown): Partial<Record<CapabilityBucket, UiProfileId>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<CapabilityBucket, UiProfileId>> = {};
  for (const bucket of VALID_BUCKETS) {
    const raw = value[bucket];
    if (typeof raw === 'string' && VALID_PROFILE_IDS.includes(raw as UiProfileId)) {
      out[bucket] = raw as UiProfileId;
    }
  }
  return out;
}

function parseShownHints(value: unknown): Partial<Record<UiProfileId, boolean>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<UiProfileId, boolean>> = {};
  for (const id of VALID_PROFILE_IDS) {
    if (value[id] === true) out[id] = true;
  }
  return out;
}

function parseProfile(value: unknown, fallback: UiProfile): UiProfile {
  if (!isRecord(value)) return { ...fallback };
  const movementWidgets: readonly MovementWidget[] = ['leftStick', 'tapMove', 'leftRightButtons', 'keyboard'];
  const aimWidgets: readonly AimWidget[] = ['firePad', 'facingOnly', 'skillDragOnly', 'mouse'];
  const layouts: readonly SkillBarLayout[] = ['bottom', 'left', 'right', 'cluster-right'];
  const hints: readonly HintVerbosity[] = ['auto', 'minimal', 'verbose'];
  const handedness: readonly Handedness[] = ['left', 'right'];
  return {
    id: VALID_PROFILE_IDS.includes(value.id as UiProfileId) ? (value.id as UiProfileId) : fallback.id,
    movementWidget: readEnum(value.movementWidget, movementWidgets, fallback.movementWidget),
    aimWidget: readEnum(value.aimWidget, aimWidgets, fallback.aimWidget),
    showFirePad: typeof value.showFirePad === 'boolean' ? value.showFirePad : fallback.showFirePad,
    showMovePad: typeof value.showMovePad === 'boolean' ? value.showMovePad : fallback.showMovePad,
    showJumpButton:
      typeof value.showJumpButton === 'boolean' ? value.showJumpButton : fallback.showJumpButton,
    skillBarLayout: readEnum(value.skillBarLayout, layouts, fallback.skillBarLayout),
    widgetScale: readNumber(value.widgetScale, fallback.widgetScale, 0.75, 1.35),
    widgetOpacity: readNumber(value.widgetOpacity, fallback.widgetOpacity, 0.25, 1),
    handedness: readEnum(value.handedness, handedness, fallback.handedness),
    hints: readEnum(value.hints, hints, fallback.hints),
  };
}
