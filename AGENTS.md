## Analysis workflow
- Use `code-review-graph` first for code-impact tasks, blast radius, and review questions.
- Use `graphify` for architecture recovery and cross-doc reasoning.
- Use `ast-grep` for structural search, repo boundary checks, and codemods.

### Daily review order
1. `code-review-graph get_minimal_context`
2. `code-review-graph detect_changes`
3. `code-review-graph get_impact_radius`
4. `code-review-graph get_affected_flows`
5. `npm run lint`
6. `npm run build`
7. `npm run test`
8. `npm run test:e2e` when UI, hosting, or multiplayer flows changed
9. `npm run lint:structural`

### Graphify usage
- Read `graphify-out/GRAPH_REPORT.md` first when it exists.
- After code-only edits, refresh with `graphify update .`.
- After docs/architecture edits, run full graphify refresh workflow before trusting doc-related answers.

### Schema changes
- After any SpacetimeDB schema change, run `npm run stdb:build` and `npm run stdb:generate` before trusting generated bindings.

### Control ergonomics architecture
- `src/input/profiles.ts` owns widget/layout presets. `src/input/profileRegistry.ts` owns runtime behavior such as override composition, pointer-world mode, fire-pad role, and joystick constraints.
- Keep control behavior data-driven. Prefer registry entries and override keys over new profile-id string branches in `src/app.ts` and `src/input/InputController.ts`.
- `adaptProfileToRules()` in `src/input/profiles.ts` is the public wrapper, but compatibility metadata now lives in `src/input/profileRegistry.ts`. New profiles still need an explicit compatibility decision there.
- Keep `PlayerInput` canonical. Local control experiments should map into existing move/aim/slot events unless gameplay truly needs a new wire-level concept.
- Tap-fire world-pointer lifecycle now lives in `src/input/tapFirePointerGesture.ts`. If touch world-pointer logic grows further, extend that controller layer instead of re-inlining the gesture code in `src/app.ts`.

### ast-grep scope
- **Primary use: structural search before edits.** Before touching code, use
  `sg run --pattern '...' src/ spacetimedb/src/` to find every site matching a pattern — e.g.
  all callers of a method, all accesses to `import.meta.env`, or all `new ClassName(...)` sites.
  This is faster and more precise than grep for code patterns.
- **Secondary use: repo rules.** `sg scan` uses the root `sgconfig.yml` and the rules in `ast-grep/rules/`.
- Keep rules focused on repo boundaries such as room directory construction and centralized env access.
- Prefer warning-level checks first; promote to stricter enforcement after cleanup.

#### Quick search examples
```bash
# Find all EngineClient instantiations
sg run -p 'new EngineClient($$$)' src/

# Find all direct Vite env reads in client code
sg run -p 'import.meta.env.$KEY' src/

# Find all room directory adapter constructions
sg run -p 'new LocalRoomDirectory($$$)' src/
sg run -p 'new HttpRoomDirectory($$$)' src/
sg run -p 'new SpacetimeRoomDirectory($$$)' src/
```