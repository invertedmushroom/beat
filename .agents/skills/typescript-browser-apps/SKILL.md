---
name: typescript-browser-apps
description: >
  Build and debug TypeScript browser apps at runtime boundaries. Use when changing
  runtime input validation, browser persistence or migrations, resource lifecycles,
  suspend/resume behavior, browser capabilities, or PWA installation, caching,
  offline support, and service-worker updates.
---

# TypeScript Browser Apps

Make state authority, resource ownership, and failure behavior explicit. Apply only
the branches touched by the task. Keep framework, storage, and networking choices
local to the project.

## 1. Establish the affected contract

Read the available owning architecture, contracts, and invariants. Inspect the
relevant entrypoints, dependency versions, configuration, and tests.

For each affected boundary, identify the applicable parts before editing:

- The input boundary and the module that validates input.
- The authoritative state and the module that publishes or persists changes.
- The resource owner, disposal point, and callbacks that can outlive that owner.
- The expected failure and recovery behavior.

Discovery is complete when each affected boundary has an evidenced owner and an
observable acceptance check. Reuse existing parsers, persistence adapters, and
lifecycle mechanisms before adding another abstraction.

## 2. Load the relevant branch

| When the task changes... | Read and apply |
|---|---|
| JSON, messages, imports, or runtime configuration | [Typed boundaries](./references/browser-runtime.md#typed-boundaries) |
| Stored data, schema versions, or migration | [Persisted state](./references/browser-runtime.md#persisted-state) |
| Listeners, timers, workers, subscriptions, or asynchronous callbacks | [Resource lifetimes](./references/browser-runtime.md#resource-lifetimes) |
| Focus, visibility, restoration, permissions, fullscreen, camera, or wake lock | [Suspend and capabilities](./references/browser-runtime.md#suspend-and-capabilities) |
| Manifest, installation, service worker, caches, offline behavior, or updates | [PWA delivery](./references/pwa-delivery.md) |

Keep the selected branch's state transitions and failure outcomes explicit in the
implementation and tests. When behavior changes, update the existing owning
contract in the same change.

## 3. Verify the changed behavior

Use the project's existing type-check, lint, and test commands.

- Use focused tests for parsers, migrations, and state transitions.
- Exercise the selected branch's failure, disposal, and recovery checks.
- When PWA behavior changes, exercise the applicable
  [production checks](./references/pwa-delivery.md#production-checks).
- Keep capability stubs separate from evidence of actual browser support.

Finish with the checks run and any unverified browser or platform behavior.
A successful build alone does not establish lifecycle, persistence, or offline
correctness.

When evaluating changes to this skill, use the
[behavioral evaluation guide](./evals/EVALUATION.md).
