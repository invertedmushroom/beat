---
name: advanced-rust-integration
description: >
  Debug Rust SDK and crate integrations by inspecting the exact resolved crate
  source, feature graph, and callback bounds. Use when trait resolution,
  feature flags, generated handles, or version-specific crate internals are unclear.
---

# Advanced Rust Integration & Debugging

Inspect the resolved crate source and version-matched documentation whenever compiler diagnostics or examples do not establish an integration's behavior.

## 1. Resolve Exact Dependency Source & Active Features

From the target workspace or manifest, resolve the exact package version, `manifest_path`, and enabled feature graph (`resolve.nodes[].features`, not `packages[].features`):

```powershell
rtk proxy cargo tree --locked -i my-crate@1.2.3
rtk proxy cargo tree --locked -e features -i my-crate@1.2.3
rtk proxy cargo metadata --format-version 1 --locked --offline
```

- Use `rtk proxy` for raw machine-readable JSON, and filter to the target package rather than dumping the entire workspace.
- Read the matching package's `manifest_path` from `cargo metadata` (typically under `CARGO_HOME/registry/src/`, git checkouts, or path patches) rather than globbing `.cargo` cache directories.

## 2. Inspect Declarations, Feature Gates & Trait Families

Search the resolved crate's `src/` (and any generated module files) for the exact trait, method, and `#[cfg(feature = ...)]` guards:

```powershell
rtk proxy rg -n 'trait MyTrait|fn my_method' path/to/resolved-crate/src
rtk proxy rg -n 'impl.*MyTrait|cfg\(feature' path/to/resolved-crate/src
```

Verify:
- Whether the method is inherent or belongs to a specific trait family (e.g., `tower::Service` vs. `tower::ServiceExt`, or `serde::Deserialize` vs. `serde::de::DeserializeOwned`), and disambiguate with `<ConcreteType as TraitName>::method(...)` when needed.
- Callback bounds (`Fn`, `FnMut`, `Send`, `'static`), whether arguments are borrowed only for the callback duration, and whether state is cached or transaction-local.

## 3. Callback-to-Loop Handoff Checklist

When an SDK callback must hand off owned data to a synchronous frame/tick loop (e.g., via `crossbeam_channel`):
- Clone borrowed callback values before sending across the channel.
- Define an explicit queue policy: unbounded queues require bounded event rates and a consumer drain budget; bounded `try_send` queues require an explicit full/disconnected policy (avoid blocking `send` inside SDK delivery callbacks).
- Keep a single receiver per ordered event stream (cloned `crossbeam_channel::Receiver` handles compete for messages rather than broadcasting).
- Construct non-`Send` / thread-affine handles on their owning thread and send `Send` payloads or IDs across the channel.

## 4. Verify

Run `rtk cargo check -p <affected-package>` with the exact target/features, and run a focused runtime test whenever the issue involves callback delivery, lifetime, queue backpressure, or teardown.
