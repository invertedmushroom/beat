---
name: domain-modeling
description: Explore and refine domain concepts, behavior, ownership, state transitions, and invariants. Use when designing a domain model, resolving consequential ambiguity in business rules or terminology, or editing architecture documentation, a glossary, or an ADR to clarify those domain concerns. Discussion in passing does not by itself authorize documentation edits.
---

# Domain Modeling

Develop a coherent model of the domain before choosing implementation structures. The model lives in behavior — concepts, ownership, operations, state transitions, invariants — not in documentation artifacts. Documentation is an optional outcome, produced when it preserves knowledge that would otherwise be hard to recover or serves as an explicit behavioral contract.

## Process

1. Identify the relevant domain concepts and actors.
2. Establish ownership and responsibilities: who may change what, and when.
3. Identify operations, states, and valid transitions.
4. Invent concrete edge-case scenarios that stress the boundaries between concepts and force precision. ("Who can cancel an order? In which states? What happens after payment settles?")
5. State the invariants that constrain behavior.
6. Compare the model against existing code, contracts, and tests. When the user states how something works, check whether the code agrees and surface contradictions: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"
7. Surface unresolved decisions and trade-offs explicitly.

## Terminology

Challenge a term only when its ambiguity has consequences — when one name conceals incompatible behaviors, owners, or lifecycles. "You're saying 'account': do you mean the Customer or the User? Those have different permissions." Choosing a canonical name is a means of exposing behavioral differences, not an end in itself.

## Documentation

Follow the repository's documentation ownership rules when present. Otherwise, use these defaults. Record each resolved fact only when the task calls for it:

- Seam guarantees and failure/recovery behavior → `docs/contracts/`
- Cross-cutting constraints → `docs/invariants.md`. When a contract already owns a guarantee, index it by link.
- Implemented structure → `docs/architecture.md`
- Consequential, hard-to-reverse decisions → `docs/adr/` (see below)
- Ambiguous domain vocabulary → a glossary, if useful (format and repo layout in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md))

Keep one maintained definition of each fact. Link to that definition from other documents. ADRs preserve rationale and link to current guarantees in their owners.

When terminology merely comes up while working on something else, discussion does not authorize repository edits: propose the entry and write it only if the user agrees or documentation updates are part of the requested task.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

## Completion

The domain's important behaviors, ownership, constraints, and unresolved questions are clear enough to guide design and verification — whether or not any documentation was produced.
