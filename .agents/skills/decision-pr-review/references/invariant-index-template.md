# Repository Invariant & Load-Bearing Rationale Index Template

Use this schema when creating or updating a repository's invariant index (e.g., `docs/invariants.md`) or recording load-bearing rationale discovered during a pull request review.

## Authoring Rules (Grounded in Codified Context & High-Entropy Triage)

1. **Entropy & Invariant Triage (Size Around High-Entropy Constraints):**
   - **Strip Low-Entropy Boilerplate:** Never document standard framework behavior, routine CRUD, or language semantics that any pretrained model already knows.
   - **Preserve 100% of High-Entropy Identifiers:** Only record cross-cutting system invariants, race-condition/crash-window guards, and architectural "scar tissue" (rejected simplifications). Never abbreviate exact file paths, class/function names, DB tables/columns, or environment variables.
2. **Every Invariant Entry Requires Four Elements + Optional Causal Flow:**
   - **Scope (`@MODULE`):** Exact file glob, subsystem, or service boundary where the invariant applies (acts as a trigger table so agents know when to consult the entry).
   - **Invariant (`!INVARIANT`):** Define what must always remain true when this index owns the constraint. When a contract already owns the guarantee, use a label linked to that section.
   - **Enforcement Location:** Exact file and symbol (`path/to/file.ext::symbolName()`) where the invariant is enforced, plus optional compact causal flow (`Trigger -> Guard -> StateMutation -> SideEffect`).
   - **Canonical Source:** The owning contract section, or this index entry when the constraint is defined here. Link ADRs and PRs as decision rationale and tests as enforcement evidence.
3. **Every Load-Bearing Rationale Entry Requires Four Elements:**
   - **Condition:** The operational or domain context.
   - **Forbidden Change:** The seemingly simpler optimization or refactor that must not be applied.
   - **Failure Consequence:** Specifically what breaks, and under what conditions, if the forbidden change is made.
   - **Source:** The PR, commit, issue, or test proving why the simpler approach failed.
4. **Prevent Specification Drift:**
   - Always verify relevant entries against current code before marking them `VERIFIED`.
   - When a PR changes a guarantee, update its owning definition in the same PR. Update index scope, enforcement locations, and links when those recorded facts change.

---

## Markdown Template (`docs/invariants.md`)

```markdown
# Repository Invariant & Load-Bearing Rationale Index
*Note for Review Agent: Match changed files against Scope globs. Verify relevant entries against current code before citing them as VERIFIED.*

## System Invariants

- **Scope (`@MODULE`):** [Subsystem / Exact Path Glob, e.g., Navigation (`src/nav/*`)]
  - **Invariant (`!INVARIANT`):** [Constraint defined here, or a label linked to its owning contract section]
  - **Enforcement Location:** [`path/to/file.ext::symbolName()`]
  - **Causal Flow (`@FLOW`, Optional):** [`Trigger -> Guard -> StateMutation -> SideEffect`]
  - **Canonical Source:** [Owning contract section, or this entry when the constraint is defined here]
  - **Rationale / Evidence (Optional):** [ADR, PR, or regression test]

## Load-Bearing Rationale (Rejected Simplifications)

- **Condition:** [Operational/domain condition where code looks deceptively complex]
  - **Forbidden Change:** [Do not replace exact symbol X with simpler Y]
  - **Failure Consequence:** [Causal mechanism of why Y fails in practice and what breaks]
  - **Source:** [PR #123, `tests/path/test_file.ext:line`]
```

---

## Concrete Reference Examples

```markdown
## System Invariants

- **Scope (`@MODULE`):** Navigation / Pathfinding (`src/nav/*`)
  - **Invariant (`!INVARIANT`):** A traversable edge requires continuous ground support across the entire step interval, not just valid start/end poses and an unobstructed capsule sweep.
  - **Enforcement Location:** `src/nav/edge_validator.cpp::validateContinuousSupport()`
  - **Causal Flow (`@FLOW`):** `planStep() -> validateContinuousSupport() -> sampleGroundInterval() => {reject edge if any interval sample lacks ground}`
  - **Canonical Source:** This entry.
  - **Rationale / Evidence:** `docs/adr/0014-ledge-gap-validation.md`, `tests/nav/test_gap_rejection.cpp`

- **Scope (`@MODULE`):** Billing / Charge Execution (`src/billing/*`)
  - **Invariant (`!INVARIANT`):** [Provider charge idempotency](../src/billing/README.md#idempotency-contract).
  - **Enforcement Location:** `src/billing/ledger.ts::reserveIdempotencyKey()`
  - **Causal Flow (`@FLOW`):** `ChargeService.execute() -> ledger.reserveIdempotencyKey() [DB::commit] -> ProviderClient.charge() => ledger.markSettled()`
  - **Canonical Source:** `src/billing/README.md#idempotency-contract`

## Load-Bearing Rationale (Rejected Simplifications)

- **Condition:** Validating step connectivity between two supported navigation nodes (`src/nav/edge_validator.cpp`).
  - **Forbidden Change:** Do not replace `sampleGroundInterval()` with a single `capsuleSweep()` + endpoint ground check to save raycast cost.
  - **Failure Consequence:** Supported endpoints plus a clear capsule sweep in mid-air do not prove continuous ground; agents will path across narrow chasms/gaps and fall.
  - **Source:** PR #418, `tests/nav/test_gap_rejection.cpp:42`
```
