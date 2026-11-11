# Browser State and Lifetime

## Typed boundaries

- Accept untrusted JSON, storage values, network messages, and worker messages as
  `unknown`. Validate shape and domain constraints before publishing state.
- Reuse the owning parser or schema. Type assertions and generated TypeScript
  types do not validate arbitrary runtime values.
- Construct a complete valid result before mutating live state. On rejection,
  preserve the last valid state and return an actionable diagnostic through the
  project's error channel.
- Keep invalid data, unavailable storage, permission denial, and transport
  failure distinguishable. Each outcome needs its own recovery behavior.

**Check:** Wrong types, missing fields, and invalid domain values leave live state
unchanged and produce the expected diagnostic. Valid input reaches the intended
state owner.

## Persisted state

Classify stored values as disposable preferences, durable user data, or
reconstructible caches. Identify the owner of each key/store and the authoritative
state when memory, storage, and remote data disagree.

- When stored schemas evolve, use a versioned read path: decode -> validate the
  source version and shape -> migrate supported versions -> validate the current
  shape -> publish. Keep migrations free of storage writes until validation succeeds.
- For unknown newer versions, preserve the stored data and report incompatibility.
  Keep writes disabled for that data until compatibility is established or the user
  explicitly resets the data. Returning defaults alone does not protect later saves.
- For disposable preferences, apply documented defaults and normalization.
  For durable user data, surface corruption and preserve recoverable data.
- Handle storage access, reads, and writes as separate failure points. Report a
  durable save as successful only after the persistence operation succeeds.
  For IndexedDB, await
  [transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event)
  rather than an individual request's success. Treat aborts as failed saves.
- When asynchronous saves can overlap, preserve the intended write order. A stale
  save must not overwrite newer state or mark unsaved changes as saved.
- When durable data exists only in the browser, define recovery or export behavior.
  Browser storage can be cleared or evicted. A persistence request can be denied.
- When tabs share writable data, define transaction or conflict behavior.
  Storage events and `BroadcastChannel` notifications do not serialize writes.
- When a release changes the schema, account for older open tabs. Establish
  read/write compatibility or an explicit upgrade protocol before migration.
  For IndexedDB, handle database version changes and blocked upgrades.

**Check:** Exercise current, migrated, malformed, and newer-version data.
Exercise unavailable storage, failed writes, and migration failure. Verify that
reload restores successfully saved state and that failure cannot silently erase
durable data. After loading a newer schema, attempt a normal save and verify that
the newer data remains intact. When saves can overlap, resolve them out of order.
When concurrent tabs are supported, test the chosen conflict/upgrade behavior.

## Resource lifetimes

- Give every listener, timer, observer, worker, subscription, and asynchronous
  operation an owner whose lifetime matches the resource.
- Use the project's cleanup convention. Keep registration and disposal reachable
  from the same owner.
- When initialization fails after acquiring resources, release those resources
  before reporting failure. Include media tracks and object URLs where used.
- Stop new work and invalidate pending callbacks before disposing dependent
  resources. Make repeated disposal safe.
- When callbacks can outlive disposal, replacement, or reconnect, guard state
  publication with the current owner identity or generation.
- When an API supports cancellation, cancel obsolete work. Cancellation alone
  does not prove that already queued callbacks cannot publish stale results.
- When consumers genuinely share a subscription, separate consumer release from
  shared transport shutdown. Add reference counting only for actual sharing.
- On reconnect, define when replacement subscriptions become authoritative and
  whether retained state remains visible while the replacement initializes.

**Check:** Repeated mount/dispose leaves no duplicate callbacks or live resources.
Fail initialization after partial acquisition and verify that resources are released.
Resolve old asynchronous work after replacement and verify that the old result
cannot publish. Reconnect leaves the intended number of active subscriptions.

## Suspend and capabilities

- Treat `blur`, `visibilitychange`, `pagehide`, and `pageshow` as distinct
  transitions. Choose pause, reset, release, or reacquire behavior per resource.
- For held input, clear active input on focus loss. For time-sensitive state,
  reconcile from timestamps or authoritative state after suspension rather than
  assuming that timer callbacks ran on schedule.
- Persist important changes during normal operation. Treat hidden-state saving as
  best effort because
  [mobile termination can omit lifecycle events](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event#usage_notes)
  or interrupt work.
- When a page can return from the back-forward cache, pair suspension/teardown
  with restoration. `pagehide` does not always mean permanent destruction.
- Feature-detect browser capabilities. Keep unsupported, denied, released, and
  operational-failure outcomes distinct where the API exposes those outcomes.
  Distinguish insecure origins from unsupported APIs. For phone testing, use HTTPS
  trusted by the phone. A laptop's localhost exception does not extend to its LAN IP.
- When a capability requires user activation, acquire the capability from a
  permitted user gesture.
- When a wake lock is requested, account for system release. Reacquire only when
  the page is visible and the feature still requests the lock.
- When acquisition resolves after disposal, release the acquired resource instead
  of attaching the resource to an obsolete owner.
- Publish actual capability state separately from user intent. An opted-in wake
  lock or requested fullscreen mode does not establish successful acquisition.
- Treat connectivity indicators as hints. Confirm remote availability through
  the actual operation and expose reconnect/failure state separately.

**Check:** Focus loss releases held input. Hide/restore and back/forward navigation
preserve the chosen state without duplicate resources. Unsupported APIs, denied
requests, system release, and late acquisition leave a usable UI.
