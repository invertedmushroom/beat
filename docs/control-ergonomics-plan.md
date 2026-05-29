# Control ergonomics & local UI preferences — design reference

> Status: **Implemented** and revised after the profile-registry refactor.
> Beat now splits control ergonomics into three layers:
> `src/input/profiles.ts` for widget/layout presets,
> `src/input/profileRegistry.ts` for runtime behavior,
> and `src/app.ts` + `src/input/InputController.ts` for source wiring.
>
> This document is the architectural reference for Beat's current multi-modal,
> profile-driven control system and the remaining cleanup work around it.

## 1. What Beat already has

- **Local-only UI preferences** now live in `src/ui/preferences.ts` under
  `beat.uiPreferences.v2`, with v1 fallback/migration kept intact. Profile
  choice is stored per capability bucket so the same user can prefer different
  defaults on desktop, touch-only, and hybrid devices.
- **`app.ts` hot-applies** these by setting CSS custom properties and `data-*`
  flags on `.app-shell`. UI prefs still do **not** alter the rules fingerprint
  (asserted by tests).
- **Capability detection and last-active modality tracking** exist in
  `src/input/capabilities.ts` via `detectCapabilities()` and `ModalityTracker`.
  Default profile selection is bucket-aware (`fine-only | coarse-only | hybrid`).
- **Widget layout remains fixed at the primitive level**: one movement joystick,
  one fire pad, four skill buttons, plus platform L/R + jump alternatives. The
  important change is that widget *behavior* is no longer inferred from raw
  profile-id branches spread across the app.
- **Runtime behavior is now declarative**: `src/input/profileRegistry.ts`
  defines per-profile override composition, joystick constraint, fire-pad role,
  pointer-world mode, mouse-aim policy, hint text, and labels.
- **`PointerWorldAdapter` is in active use**: `tap-move` routes canvas taps to
  movement targets, while `tap-fire` / `tank-single-tap` route them into the
  tap-fire / hold-to-charge gesture flow.
- **Rules support multiple movement modes**: `twinStick | tank | platform |
  orthogonal`, plus `aim.mode = free | facing`. Worker logic and client
  prediction both implement the orthogonal branch.
- **Automated coverage now spans both behavior and presentation**: unit tests
  cover rules adaptation and the profile registry, while Playwright covers core
  mobile movement, charged-skill aiming, tank mode, platform mode, and local
  preferences persistence.

## 2. Where the current approach breaks

- Local preferences are too shallow — mostly CSS theming knobs.
- `@media (pointer: coarse), (max-width: 760px)` conflates **viewport width**
  with **input modality**. Per MDN, `pointer` is the *primary* pointer,
  `any-pointer` covers *any* available pointer, and `navigator.maxTouchPoints`
  reports touch capacity. A narrow desktop window ≠ a phone; a touch laptop
  with a mouse attached ≠ a phone either.
- W3C explicitly discourages locking users into one input mechanism (mixed
  input is the norm: mouse + touch laptops, phones with attached keyboards,
  pen + finger, etc.).
- Ergonomics must be **rules-aware**: an always-on aim pad is wasted real
  estate in `aim.mode = 'facing'`; a circular movement stick is the wrong
  default in `platform` mode.
- A binary "phone vs desktop" decision at launch cannot follow the user when
  they pair/unpair input devices mid-session.

## 3. Design principles

1. **Rules stay authoritative** (movement mode, aim mode, speed, turn,
   reverse, gravity, jump). UI prefs must never change the rules fingerprint.
2. **Local layer becomes profile-driven**, not a flat blob. Profiles answer
   "which widgets, where, doing what, with which hints".
3. **Capabilities are detected from web standards**, not user-agent strings:
   `pointer`, `any-pointer`, `navigator.maxTouchPoints`, and
   `PointerEvent.pointerType` for last-active modality tracking.
4. **Preset-first, custom-second.** Ship a curated set of built-in profiles.
  Expose per-widget tweaks only inside a `custom` profile to avoid
  configuration overload.
5. **Profiles are rules-aware**: the active profile is filtered/adapted based
   on the active ruleset's movement/aim mode.
6. **Honor concurrent input** (WCAG): keep the touch overlay available when a
   touch event arrives, fade it when keyboard/mouse takes over — without
   discarding the user's chosen profile.
7. **Target sizes**: minimum 24×24 CSS px (WCAG AA), prefer 44×44 (AAA) for
   critical actions. Current 58×58 mobile skill buttons are a floor, not a
   regression target.
8. **Single-pointer alternatives** for any path/multi-touch gesture (WCAG
   2.5.1).

## 4. Current schema (v2)

```ts
type UiProfileId =
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

type Modality = 'keyboard' | 'mouse' | 'touch' | 'pen';

type InputCapabilities = {
  primaryPointer: 'fine' | 'coarse' | 'none';
  anyFinePointer: boolean;
  anyCoarsePointer: boolean;
  maxTouchPoints: number;
  bucket: 'fine-only' | 'coarse-only' | 'hybrid' | 'none';
};

// tracked separately by ModalityTracker, not stored in InputCapabilities
type LastActiveModality = Modality;

type UiProfile = {
  id: UiProfileId;
  movementWidget: 'leftStick' | 'tapMove' | 'leftRightButtons' | 'keyboard';
  aimWidget: 'firePad' | 'facingOnly' | 'skillDragOnly' | 'mouse';
  showFirePad: boolean;
  showMovePad: boolean;
  showJumpButton: boolean;
  skillBarLayout: 'bottom' | 'left' | 'right' | 'cluster-right';
  widgetScale: number;     // replaces touchScale
  widgetOpacity: number;   // replaces touchOpacity
  handedness: 'left' | 'right';
  hints: 'auto' | 'minimal' | 'verbose';
};

type ProfileBehavior = {
  id: UiProfileId;
  label: string;
  overrides: readonly ('single-stick-tank' | 'tap-move' | 'tap-fire')[];
  joystickConstraint: 'none' | 'tank-steering' | 'cardinal';
  firePadRole: 'aim-and-fire' | 'tank-steer';
  pointerWorldMode: 'none' | 'tap-target' | 'tap-fire';
  disablesMouseAim: boolean;
  hintText?: string;
};

type UiPreferencesV2 = {
  version: 2;
  activeProfileByBucket: Partial<Record<CapabilityBucket, UiProfileId>>;
  customProfile?: UiProfile;
  // legacy/global knobs that still make sense
  hudScale: number;
  hudDensity: 'comfortable' | 'compact';
  traceDefaultOpen: boolean;
};
```

`UiProfile` and `ProfileBehavior` are intentionally separate. `UiProfile`
describes what is shown; `ProfileBehavior` describes how input sources are
interpreted at runtime. That split is what removed most of the profile-id
branching from `app.ts` and `InputController.ts`.

Migration: load v1 → fold legacy fields into the `custom` profile defaults and
into the global knobs.

## 5. Curated profile presets

| Profile            | Movement                         | Aim / fire                              | Notes                                                                                       |
| ------------------ | -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `desktop-kbm`      | WASD                             | Mouse aim, LMB/keys cast                | Formalises today's desktop default.                                                         |
| `mmo-touch`        | Left thumbstick                  | Right fire pad + drag-to-aim on charged | Today's mobile default baseline.                                               |
| `tap-move`         | Tap empty ground = `moveTo`      | Tap actor = `engage`; skills on right   | Uses smart canvas visual position coordinate offsets. Vertical direct jump taps on spot.   |
| `tap-fire`         | Left thumbstick                  | Quick tap to fire, drag hold to aim     | Tap-to-fire hold-to-aim mobile gesture engine. Locks last aim vector on release.            |
| `tank-touch`       | Left stick (pure vert Y-slider)  | Right stick (pure horiz X-slider)       | Split tank controls: left vertical vertical Y-axis for throttle, right horizontal X-axis L/R steering. |
| `tank-single`      | Unrestrained left joystick       | Skills on opposite side                 | Single stick proportional driving (distance = throttle, angle = steering).                  |
| `tank-single-tap`  | Unrestrained left joystick       | Tap/hold on canvas + skills             | Composes single-stick tank steering with tap-fire / hold-to-charge world-tap gestures.     |
| `platform-touch`   | Discrete L/R buttons + jump      | Skills on opposite side                 | Fits `movement=platform`. Jump button on right.                                             |
| `orthogonal-touch` | Left stick (4-way gate lock)     | Skills on opposite side                 | Locks mechanical knob to horizontal or vertical axis purely to prevent diagonal drift.     |

Hints are generated from `(rules.movement, rules.aim, profile.id)`:

- twin-stick + free → "Left thumb moves, right thumb aims"
- tank + facing     → "Steer and fire in facing direction"
- platform          → "Use left/right and jump"
- tap-move          → "Tap ground to move, tap actors to engage"
- orthogonal        → "Move purely along dominant axis (no diagonals)"

## 6. Current implementation

### 6.1 Capability and preference resolution
1. `src/input/capabilities.ts` detects the current capability bucket and tracks
   the last-active modality.
2. `src/ui/preferences.ts` stores `UiPreferencesV2`, resolves the active
   profile per capability bucket, and migrates from v1 safely.

### 6.2 Presentation vs behavior split
1. `src/input/profiles.ts` owns visual/layout preset data (`UiProfile`) and the
   rules-aware compatibility table in `adaptProfileToRules()`.
2. `src/input/profileRegistry.ts` owns runtime behavior (`ProfileBehavior`):
   override composition, pad constraints, fire-pad role, pointer-world mode,
   mouse-aim policy, labels, and hint text.

### 6.3 Runtime wiring
1. `src/app.ts` reads `ProfileBehavior` to:
   - derive the profile-picker options,
   - decide pointer-world ownership (`none`, `tap-target`, `tap-fire`),
   - dispatch the declared override pipeline in order.
2. `src/input/InputController.ts` reads `ProfileBehavior` to:
   - repurpose the right pad as steering for `tank-touch`,
   - lock the left pad to Y-only for `tank-touch`,
   - lock the left pad to the dominant axis for `orthogonal-touch`,
   - preserve standard aim-and-fire semantics for the remaining profiles.

### 6.4 Remaining cleanup opportunities
- Compatibility metadata now lives alongside other per-profile behavior in
  `src/input/profileRegistry.ts`, but the fallback policy is still centralized
  rather than fully declarative. If the set of profile families grows, that may
  be worth revisiting.
- Tap-fire canvas gestures now live in `src/input/tapFirePointerGesture.ts`.
  If more world-pointer gesture variants appear, the next step is a shared
  pointer-world gesture layer rather than more one-off helpers.
- `custom` currently mirrors `mmo-touch` behavior and only customizes layout.
  If custom semantics become user-configurable, the behavior registry will need
  a custom branch too.

## 7. Test matrix

**Automated (Playwright)** — extend, don't replace:
- v1 → v2 prefs migration; rules fingerprint unchanged.
- Each preset: widgets present/absent as declared.
- Profile hot-switch mid-session.
- Tap-to-move: empty ground vs actor engage.
- Hybrid: touch event then mouse event updates hint surface but not profile.

**Manual matrix (small, repeatable)**:
- Devices: small phone portrait, large phone, tablet, touch laptop, desktop KBM.
- Rules: `twinStick`+`free`, `tank`+`facing`, `platform`.
- Ergonomics: left- and right-handed touch.

**Metrics worth recording** (not lab-grade, just structured):
- time-to-first-move, time-to-first-aimed-cast,
- accidental cast rate, accidental movement rate,
- hint dismissal rate, profile switch rate,
- restart-before-match-feels-good rate.

## 8. Non-goals

- No giant "every knob exposed" settings screen.
- No abandoning the current `UiPreferences` boundary — rules stay
  authoritative, prefs stay local.
- No vendor-specific UA sniffing. Capabilities only via standards.
- No multi-finger gestures without single-pointer fallback (WCAG 2.5.1).

## 9. Open questions

- Should `custom` remain layout-only, or should it eventually choose from the
  same behavior primitives as built-in profiles?
- Should `adaptProfileToRules()` stay as a separate compatibility table, or be
  folded into registry metadata once more profiles are added?
- Future variants such as d-pad movement, pen-hover affordances, or alternate
  orthogonal/tank pads should reuse the same canonical `PlayerInput` contract.
  The open question is only how many new local override keys they justify.
- Should profile choice be synced across devices for the same player? Current
  answer remains no — these are local ergonomics by design.

## 10. References

- MDN: `@media (pointer)`, `@media (any-pointer)`, `navigator.maxTouchPoints`,
  `PointerEvent.pointerType`.
- W3C WCAG: Concurrent Input Mechanisms; Pointer Gestures (2.5.1); Target Size
  (2.5.5 / 2.5.8).
- Repo: [src/ui/preferences.ts](src/ui/preferences.ts),
  [src/input/capabilities.ts](src/input/capabilities.ts),
  [src/input/profiles.ts](src/input/profiles.ts),
  [src/input/profileRegistry.ts](src/input/profileRegistry.ts),
  [src/app.ts](src/app.ts),
  [src/input/InputController.ts](src/input/InputController.ts),
  [src/net/pointerWorldAdapter.ts](src/net/pointerWorldAdapter.ts),
  [tests/solo-smoke.spec.ts](tests/solo-smoke.spec.ts),
  [AGENTS.md](AGENTS.md).
