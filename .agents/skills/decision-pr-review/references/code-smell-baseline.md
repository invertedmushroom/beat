# Module Depth & Code Smell Baseline

Use this reference during `decision-pr-review` whenever a diff introduces new abstractions, grows existing modules, refactors control flow, or exhibits structural friction.

## Governing Rules

1. **Repo Conventions & Load-Bearing Rationale Win:** A documented repository convention or verified load-bearing rationale (Chesterton's Fence) always overrides a generic smell heuristic.
2. **Propose the Structural Move, Not Just the Label:** Never complain that code is "complex" or "smelly" without naming the concrete restructuring that removes moving parts.
3. **Severity Routing:**
   - Route localized smells and safe simplifications to **`[IMPROVEMENT | VERIFIED]`**.
   - Escalate to **`[DECISION REQUIRED]`** when a smell warps a public/cross-module seam, introduces a dormant permissive bypass, or couples unrelated domain layers.

---

## 1. Module Depth & Seam Discipline (Ousterhout)

Evaluate every new or modified module, class, trait, or helper against four checks:

- **Deep vs. Shallow:** A **deep** module hides significant domain behavior behind a small, simple interface. A **shallow** module has an interface (parameters, type bounds, preconditions, setup) nearly as complex as its body.
- **The Deletion Test:** Imagine deleting the module or helper. If complexity vanishes, it was a pass-through wrapper. If complexity reappears across $N$ callers, it earns its keep.
- **Reduced vs. Relocated Complexity:** Count the concepts a reader must hold in mind to trace the flow. If a refactor moves logic into new files/helpers while leaving the concept count unchanged, it relocated complexity rather than reducing it. Prefer restructurings that make whole branches, modes, or temporal coupling disappear.
- **Real vs. Hypothetical Seams:** One concrete implementation/adapter across a trait or interface is a hypothetical seam (pure indirection). Two concrete implementations (e.g., production transport + deterministic in-memory test fake) justify the seam.

---

## 2. High-Signal Code Smells & Structural Remedies

| Smell | Observable Signal in Diff | Concrete Structural Remedy |
| :--- | :--- | :--- |
| **Shallow Pass-Through (`Middle Man`)** | Function or struct mostly delegates to another module without adding policy or hiding state. | Delete the wrapper and call the target directly, or deepen the module so it absorbs caller orchestration. |
| **Bolted-On Conditional** | A feature-specific `if`/`match` branch is wedged into an unrelated orchestration or shared flow. | Move the policy into the owning domain module or represent it in the type/state model so the shared path stays uniform. |
| **Repeated Switches** | The same `match`/`switch`/`if`-cascade over the same variant or tag recurs across multiple hunks/files. | Consolidate into a single exhaustive dispatch table or method on the enum/type. |
| **Feature Envy** | A function reaches into another struct/module's fields or getters more than its own. | Move the function onto the type whose data it inspects or mutates. |
| **Data Clumps & Flag Sprawl** | The same 3+ parameters travel together across calls, or boolean flags (`do_work(true, false)`) switch behavior modes. | Bundle co-traveling parameters into a domain struct; replace boolean mode flags with explicit named functions or an enum policy. |
| **Primitive Obsession** | Raw integers, strings, or tuples stand in for domain IDs, units, layers, or lifecycle states. | Parse/validate at the boundary into a small domain type (`Newtype` / enum) so downstream defensive checks disappear. |
| **Shotgun Surgery** | One logical behavior change requires lockstep edits across many scattered files. | Co-locate the coupled state and rules into one owning module. |
| **Divergent Change** | A single large file grows further because unrelated concerns (I/O, domain rules, formatting) live together. | Decompose first along responsibility seams before adding another feature slice. |
| **Speculative Generality** | Unused parameters, generic type parameters with one instantiation, or hooks added "for future use." | Delete and inline until a second concrete caller exists. *(Flag uncalled permissive helpers as `DECISION REQUIRED`).* |
| **Misleading / Mysterious Name** | Generic identifiers (`data`, `result`, `temp`, `process`) or a `get_*`/`is_*` query that mutates state. | Rename to state the exact domain value or side effect; split queries from mutations. |
