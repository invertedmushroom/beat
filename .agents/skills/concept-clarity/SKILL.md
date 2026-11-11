---
name: concept-clarity
description: Build a precise, progressive mental model of a technical concept, code path, or invariant when an explanation or mechanism is difficult to follow.
disable-model-invocation: true
---

# Concept Clarity

Explain the selected concept to a technically capable engineer who is unfamiliar with this specific mechanism. **Reduce cognitive load, not technical depth.** Teach the real model, not a child-friendly substitute.

## Invocation

Use `/concept-clarity` with a question, selected code, error, diagram, or passage. If no selection is supplied, explain the specific concept currently under discussion. Respect the user's existing background; skip prerequisites they already know. When explaining code or behavior in the current repository, use the canonical terms from `docs/architecture.md` (or the codebase) and honor any matching constraints in `docs/invariants.md`.

## Method

1. **Orient.** In one or two sentences state what the concept is, what problem it solves, and what the reader should be able to predict by the end.
2. **Anchor in the familiar.** Connect to one familiar mechanism only if that connection is structurally sound, and **state the exact point where the analogy breaks down**.
3. **Reveal one mechanism at a time.** Give the smallest concrete example that exhibits the behavior. Define new terminology at first use, and introduce only terms needed for the current step.
4. **Make state and causality visible.** For behavior involving memory, execution, concurrency, ownership, data flow, or state transitions, show a labelled ASCII diagram, timeline, or before/after state table (`Initial State -> Trigger -> Guard -> Mutation -> Resulting State`). Distinguish conceptual models from actual runtime memory layout and compile-time checks.
5. **Trace the example.** Walk through the execution in strict causal order (`Initial State -> Trigger -> Guard -> Mutation -> Resulting State`), tying each state change to the exact `file.ext:line::symbol` identifier in the example.
6. **State the precise invariant & boundary.** State the governing technical rule and one load-bearing edge case, failure mode, or limitation. Correct any earlier simplification before it hardens into a false assumption.
7. **Check transfer.** Finish with one small variation and a concrete prediction question the reader can answer to test their mental model. Offer the next deeper layer without launching into it automatically.

## Depth Control & Output Shape

Default to **one concept, one worked example, and one meaningful caveat**. If understanding requires multiple prerequisites, name the chain and teach the first missing link rather than explaining everything at once. Prefer real code, exact identifiers, and concrete state traces over decorative metaphors. Label what is stored, borrowed, copied, moved, or mutated. State conditional rules condition-first ("When X holds, Y happens"), and preserve epistemic modality (`may` vs. `will`) when describing runtime behavior.

Adapt headings naturally (`Core Idea` → `Minimal Example & Trace` → `Precise Rule & Edge Case` → `Quick Check`) rather than forcing a rigid report.

## Completion Criterion

The reader can predict the outcome of a small perturbation to the example and explain *why* using the exact technical terms. If unstated prerequisites block that, name the missing prerequisite explicitly.

## Scope

Explanation only. Do not edit code or repository documentation unless separately asked.