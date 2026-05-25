# Control ergonomics & local UI preferences — design plan

> Status: **research / design**, not yet implemented.
> Owner: TBD. Captured from a deep-research pass on the existing Beat codebase
> (`src/utils/preferences.ts`, `src/app.ts`, `src/input/`, `src/net/pointerWorldAdapter.ts`,
> the workbench Local Preferences panel, and existing Playwright coverage) plus W3C/MDN
> guidance on mixed input, pointer media queries, and target sizing.
>
> The goal of this doc is to give the next implementer a single source of truth so the
> work doesn't degrade into ad-hoc switches inside `InputController`.

## 1. What Beat already has

- **Local-only UI preferences** live in `src/ui/preferences.ts` under
  `beat.uiPreferences.v1`. Currently: HUD scale, skill-bar position, touch
  handedness, touch scale, touch opacity, trace-open state, HUD density. Parser
  clamps and falls back safely — good base pattern.
- **`app.ts` hot-applies** these by setting CSS custom properties and `data-*`
  flags on `.app-shell`. UI prefs do **not** alter the rules fingerprint
  (asserted by an existing test).
- **Touch layer** is fixed: one movement joystick, one fire pad, four skill
  buttons. CSS reveals it under `@media (pointer: coarse), (max-width: 760px)`.
  Handedness only swaps pads; skill-bar position only chooses bottom/left/right.
- **`InputController`** hardcodes concrete widgets (joystick, firePad,
  skillButtons), keyboard, mouse, pointer capture, aim memory, and slot-0
  click-to-cast. New schemes risk becoming branches in a single class that
  already knows too much.
- **Pointer-to-world groundwork exists but is unused**:
  `PointerWorldAdapter` emits `moveTo` / `engage` intents with world coords,
  actor picking, and `pointerType`. Wired in `BeatApp` to renderer helpers but
  not subscribed into gameplay yet.
- **Rules already support multiple modes**: movement `twinStick | tank | platform`,
  aim `free | facing`, plus platform gravity/jump. Tests cover tank firing along
  facing and platform jump/gravity.
- **Playwright coverage** exists for mobile movement, mobile charged-skill drag
  aiming, tank mode, platform mode, and local-prefs persistence.

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
4. **Preset-first, custom-second.** Ship ~4 curated profiles. Expose
   per-widget tweaks only inside a `custom` profile to avoid configuration
   overload.
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

## 4. Proposed schema (v2)

```ts
type UiProfileId =
  | 'desktop-kbm'
  | 'mmo-touch'
  | 'tap-move'
  | 'tank-touch'
  | 'platform-touch'
  | 'custom';

type InputCapabilities = {
  primaryPointer: 'fine' | 'coarse' | 'none';
  anyFinePointer: boolean;
  anyCoarsePointer: boolean;
  maxTouchPoints: number;
  lastActiveModality: 'keyboard' | 'mouse' | 'touch' | 'pen';
};

type UiProfile = {
  id: UiProfileId;
  movementWidget: 'leftStick' | 'tapMove' | 'leftRightButtons';
  aimWidget: 'firePad' | 'facingOnly' | 'skillDragOnly';
  showFirePad: boolean;
  showMovePad: boolean;
  showJumpButton: boolean;
  skillBarLayout: 'bottom' | 'left' | 'right' | 'cluster-right';
  widgetScale: number;     // replaces touchScale
  widgetOpacity: number;   // replaces touchOpacity
  handedness: 'left' | 'right';
  hints: 'auto' | 'minimal' | 'verbose';
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

`CapabilityBucket` is a coarse classification (e.g.
`fine-only | coarse-only | hybrid`) used to pick a different default profile
per device class for the same user. This is the W3C "concurrent input
mechanisms" recommendation expressed as storage.

Migration: load v1 → fold legacy fields into the `custom` profile defaults and
into the global knobs.

## 5. Curated profile presets

| Profile          | Movement                         | Aim / fire                              | Notes                                                                                       |
| ---------------- | -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `desktop-kbm`    | WASD                             | Mouse aim, LMB/keys cast                | Formalises today's desktop default.                                                         |
| `mmo-touch`      | Left thumbstick                  | Right fire pad + drag-to-aim on charged | Today's mobile default; Flyff-style baseline.                                               |
| `tap-move`       | Tap empty ground = `moveTo`      | Tap actor = `engage`; skills on right   | Uses existing `PointerWorldAdapter`. No movement stick. Larger skills / spare space.        |
| `tank-touch`     | Left stick *or* fwd/rev + L/R    | No independent aim pad; fire follows facing | Fits `movement=tank` + `aim=facing`. Drop the aim pad rather than fake it.              |
| `platform-touch` | Discrete L/R buttons + jump      | Skills on opposite side                 | Fits `movement=platform`. Temporary aim widget only while a free-aim skill is held.         |

Hints are generated from `(rules.movement, rules.aim, profile.id)`:

- twin-stick + free → "Left thumb moves, right thumb aims"
- tank + facing     → "Steer and fire in facing direction"
- platform          → "Use left/right and jump"
- tap-move          → "Tap ground to move, tap actors to engage"

## 6. Implementation plan (phased)

### Phase 1 — foundation, no behavior change
1. Add `src/input/capabilities.ts` exporting `detectCapabilities()` and a
   `last-active modality` tracker that updates from `PointerEvent.pointerType`
   and key events.
2. Add `UiPreferencesV2` types + migration in
   [src/ui/preferences.ts](src/ui/preferences.ts). Keep the v1 storage
   key readable; write v2 to a new key (`beat.uiPreferences.v2`) so a
   downgrade still works.
3. Introduce `src/input/profiles.ts` with the four presets + `custom`. No
   wiring yet.
4. Extend the existing Playwright local-prefs persistence test to cover v1→v2
   migration. Assert rules fingerprint still unchanged.

### Phase 2 — refactor `InputController` by responsibility
Split into:
- **CapabilityDetector** (Phase 1).
- **ProfileResolver** — picks active profile from `(capabilities, rules, prefs)`.
- **WidgetLayer** — owns DOM widgets (joystick, fire pad, skill buttons,
  jump button, L/R buttons). Mounts/unmounts based on the active profile.
- **InputMapper** — turns raw inputs from the active widgets into canonical
  `PlayerInput`. One mapper per movement/aim widget family.

`InputController` becomes a thin coordinator. Do not add more `if (widget)`
branches to the current class.

### Phase 3 — tap-to-move
- Subscribe `PointerWorldAdapter`'s `moveTo` / `engage` intents into gameplay
  **only when the active profile is `tap-move`** (or `custom` opts in).
- Canvas `pointerdown` ownership is decided by the profile: either the
  direct-fire mapper (today's behavior) or the pointer-world mapper. Never both.
- Add Playwright coverage: tap empty ground moves; tap actor engages; profile
  switch hot-swaps ownership without reload.

### Phase 4 — Controls panel in arena
- Today, prefs only live in the workbench, which disappears during play.
- Add a Controls subpanel reachable from the arena HUD with: profile picker,
  handedness, widget scale, widget opacity, hints verbosity, "Preview controls"
  button.
- "Preview controls" launches a stripped-down local preview using the existing
  lab/local-bench code path with a dummy actor — no multiplayer, no rules
  mutation. Cheap to build because the lab already does this.

### Phase 5 — hybrid device polish
- Surface touch overlay opportunistically when a `touch`/`pen` pointer event
  arrives, fade it when `mouse`/`keyboard` becomes the last-active modality.
  Never discard the user's profile choice; only the visibility/affordance of
  the overlay changes.

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

- Should `customProfile` be one global custom, or one per capability bucket?
  Default suggestion: one global custom, but `activeProfileByBucket` can still
  pick a different built-in preset per bucket.
- Should profile choice be synced across devices for the same player?
  Current answer: no — these are local ergonomics and that's the whole point
  of keeping them out of the rules layer.
- Where does the "Preview controls" arena live structurally — under `rooms/`
  as a synthetic local room, or as a renderer-only sandbox? Likely the
  former, reusing the lab path.

## 10. References

- MDN: `@media (pointer)`, `@media (any-pointer)`, `navigator.maxTouchPoints`,
  `PointerEvent.pointerType`.
- W3C WCAG: Concurrent Input Mechanisms; Pointer Gestures (2.5.1); Target Size
  (2.5.5 / 2.5.8).
- Repo: [src/ui/preferences.ts](src/ui/preferences.ts),
  [src/app.ts](src/app.ts),
  [src/input](src/input),
  [src/net/pointerWorldAdapter.ts](src/net/pointerWorldAdapter.ts),
  [tests/solo-smoke.spec.ts](tests/solo-smoke.spec.ts),
  [AGENTS.md](AGENTS.md).
