---
name: porting-spec
description: Compile a codebase or feature into a language-agnostic porting spec — self-contained instructions for reimplementing the behavior in another language or project. Use when asked to port or rewrite a project, extract a feature's behavior for reuse elsewhere, or compress a codebase into a dense reimplementation blueprint.
---

# Porting Spec

Compile a **porting spec**: a single Markdown file that lets a cold-start agent reimplement the source system — or one feature of it — in an arbitrary language, without reading the source codebase. The spec transfers *behavior*, not code: contracts, data shapes, causal flows, invariants, and the acceptance evidence that proves a reimplementation matches.

## Step 1: Scope

Pin the scope with the user: the **whole project**, or a named **feature list**. Each feature becomes one slice. When the request names a target language or host project, record both in the spec header — they decide what counts as a host binding in Step 3.

## Step 2: Triage sources

Read the smallest authoritative set: `docs/architecture.md`, `docs/invariants.md`, `docs/contracts/`, ADRs for the scoped area, then code for anything those documents do not own. Sort every fact by **entropy**:

- **Specify (high entropy):** domain vocabulary and data model, wire formats, schemas, error codes and exit codes, state machines, ordering requirements, concurrency guards, security boundaries, non-obvious couplings, and the rationale behind rejected alternatives. A reimplementor cannot rediscover these; omitting one produces a silently different system.
- **Omit (low entropy):** CRUD boilerplate, framework defaults, idiomatic language mechanics, and anything a competent implementer rebuilds for free in the target language. Specifying these drags the source language's idioms into the port.

Keep exact identifiers verbatim where they are part of the behavior (table names, wire fields, error codes, CLI flags, fragment syntax). Describe by role where they are source-language artifacts (trait names, module layout, framework types).

## Step 3: Compile the spec

Write one file in this layout. The global header is always read; each slice must stand alone beside it.

```markdown
# PORTING SPEC
@META source=<repo> | role=<1-line system purpose> | scope=<whole | feature list> | target=<language/project, if named>

## @DOMAIN
Core concepts, their relationships, and the data model. One canonical term per concept.

## !GLOBAL_INVARIANTS
- `!INVARIANT [Scope]`: system-wide rule the reimplementation must preserve.

## @SLICE_MANIFEST
- `SLICE:<ID>` :: feature name & one-line responsibility.

<!-- === SLICE:<ID> START === -->
## @SLICE [<ID>] :: <feature name>
- **Contract:** operations as typed signatures (`capture(path, options) => Outcome | Error(code)`), inputs, outputs, and every error case with its code.
- **Data:** exact schemas, wire formats, and persisted shapes this slice owns.
- **@FLOW [Name]:** causal chains (`Trigger -> Guard -> StateMutation -> SideEffect`). Operators: `->` sync step, `=>` return/emission, `::` state read/write, `|` branch/fallback, `&` parallel.
- **!INVARIANT [Name]:** scar tissue — race guards, security boundaries, ordering traps, and what a refactor or port must never do. Include the load-bearing rationale when an obvious simplification was rejected.
- **Host bindings:** the platform- or language-specific edges (registry keys, SQLite, process spawning), each stated as the *guarantee the replacement must provide*, not the current implementation.
- **Acceptance:** concrete scenarios with inputs and expected observable outputs (golden outputs, exit codes, state assertions) that prove a reimplementation matches. Lift these from the source project's tests.
<!-- === SLICE:<ID> END === -->
```

Order flows causally, not alphabetically. Keep each flow step under ~5 words.

Save the spec where the user directs; default to `docs/porting-spec.md` in the source repository.

## Step 4: Cold-start check

The spec is done when every slice passes the **cold-start test**: an agent given only the global header plus that one slice can (a) reimplement the feature in a different language and (b) verify the result against the slice's acceptance scenarios — with no access to the source codebase. Audit each slice for the questions a builder would hit ("what happens on duplicate capture?", "which error code for an offline root?") and fill the gaps from the source before delivering. A slice that references another slice for required behavior fails the test; inline the needed fact or promote it to the global header.
