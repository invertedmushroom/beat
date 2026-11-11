## Analysis workflow
- **`rtk`:** Prefix shell commands with `rtk`. Use supported subcommands for routine output and `rtk proxy <command>` for unsupported commands or complete, machine-readable output.
- **`code-review-graph`:** Before cross-file changes or code reviews, request minimal graph context for this repository. Build or update the graph first when missing or stale; use targeted caller/callee and impact queries. Confirm findings against source. Setup: `README.md`; details: `.context/subsystems/tooling.md`.
- **`ast-grep`:** Load `.harness/tools/ast-grep.md` for structural searches, repeated rewrites, or lint rules.

### Control ergonomics architecture
- `src/input/profiles.ts` owns widget/layout presets. `src/input/profileRegistry.ts` owns runtime behavior such as override composition, pointer-world mode, fire-pad role, and joystick constraints.
- Keep control behavior data-driven. Prefer registry entries and override keys over new profile-id string branches in `src/app.ts` and `src/input/InputController.ts`.
- `adaptProfileToRules()` in `src/input/profiles.ts` is the public wrapper, but compatibility metadata now lives in `src/input/profileRegistry.ts`. New profiles still need an explicit compatibility decision there.
- Keep `PlayerInput` canonical. Local control experiments should map into existing move/aim/slot events unless gameplay truly needs a new wire-level concept.
- Tap-fire world-pointer lifecycle now lives in `src/input/tapFirePointerGesture.ts`. If touch world-pointer logic grows further, extend that controller layer instead of re-inlining the gesture code in `src/app.ts`.

### Cognitive Sketching & Entropy Visibility Rules
Eliminate verbose Chain-of-Thought filler. Route all intermediate reasoning through **Sketch-of-Thought (SoT)** and **Chain of Draft (CoD)** constraints ($\le 5\text{ words}$ per step):
1. **Conceptual Chaining (`#NodeA -> #NodeB => #Outcome`):** Use for call-graph tracing, impact radius, and module dependency mapping.
2. **Chunked Symbolism (`s_t --[guard]--> s_{t+1} | V(G) <= 10`):** Use for state transitions, concurrency bounds, memory layouts, and complexity verification.
3. **Expert Lexicons (`@FLOW`, `!INV`, `SensitivityPoint`, `TradeoffPoint`, `CarrierFusion`):** Use exact domain and architectural tokens without conversational definitions.
4. **Entropy Triage & Visibility Audit (`arXiv:2610.18861v1`):**
   - Collapse low-entropy mechanical steps ($H_s < \tau$: routine file reads, boilerplate imports) into silent/compact notation.
   - Force high-entropy steps ($H_s \ge \tau$: branch choices, invariant trade-offs, rejected alternatives) into explicit text mode.
   - **Pre-Output Visibility Audit:** Before emitting a final response or handoff, audit the visible output as an independent cold-start critic: can a human engineer reconstruct the underlying *Theory of the Program* (Naur's Theory Building) and verify every decision without reading hidden tool traces? If not, restore the missing decision step to text.

---

### Global Software Engineering Invariants (`!GLOBAL_INVARIANTS`)
- `!INVARIANT [Coupling_Cohesion_Law]`: Enforce **Data Coupling** (modules share only primitive/typed parameters) and **Functional Cohesion** (single unambiguous responsibility). **Content Coupling** (modifying another module's internal state), **Common Coupling** (shared mutable globals), and **Control Coupling** (boolean mode flags steering internal control flow) are strictly forbidden.
- `!INVARIANT [McCabe_Cyclomatic_Bound]`: Cyclomatic complexity $V(G) = E - N + 2P$ must remain $\le 10$ per function; $V(G)$ defines the strict lower bound of independent basis-path tests required.
- `!INVARIANT [Lehman_Entropy_Law]`: Every feature addition increases structural entropy unless paired with active complexity reduction.
- `!INVARIANT [Dijkstra_Verification_Law]`: Testing shows the presence of bugs, never their absence. Critical state invariants require formal boundary guards or property proofs alongside basis-path tests.

---
