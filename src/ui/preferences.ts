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
