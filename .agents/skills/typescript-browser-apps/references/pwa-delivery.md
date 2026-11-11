# PWA Delivery

## Establish the offline and update contract

Establish whether the app uses a manifest alone or also registers a service worker.
Preserve manifest-only deployments when the task concerns installation metadata.
When a worker is involved, inspect the installed integration version, registration
entrypoint, and built worker. Distinguish generated workers, injected precache
manifests, and custom workers before changing implementation.

- Define what works offline: the shell, specific routes, cached reads, or durable
  queued writes. An installable shell does not establish offline data correctness.
- Identify authoritative data separately from response caches.
- When offline writes are required, define durable acknowledgement, retry,
  idempotency, and conflict behavior before adding a queue.
- Identify unsaved input, pending writes, and active sessions that an update could
  interrupt. Choose activation and reload behavior from that state-loss risk.
- For unfinished work that cannot survive reload, prefer confirmation or deferred
  updates. Use automatic reload only under an explicit safe-state contract.

Use version-matched documentation rather than copying options between
integrations. [Vite PWA's update guidance](https://vite-pwa-org.netlify.app/guide/auto-update)
explains why automatic reload can discard form input.

## Scope requests and caches

- Choose caching by resource class: versioned assets, documents, public runtime
  data, and user-specific data have different freshness and ownership requirements.
- Match navigation fallback only to intended document routes. Preserve API
  failures and missing-asset errors instead of returning successful HTML.
- Cache only intended responses. Define runtime cache bounds and expiry.
- When caching user-specific responses, define identity partitioning and
  invalidation on logout or account change.
- During cleanup, delete only caches owned by the application. Preserve assets
  needed by supported older clients. Keep cache cleanup separate from user-data
  deletion.
- Coordinate server asset retention with the update contract. Open older pages
  may request lazy chunks after a new deployment even when the shell is cached.
- Keep the worker URL stable within the deployment base. Verify the intended
  worker scope and secure-context requirements.
- When deploying under a path prefix, align bundler base, router behavior,
  manifest URLs, worker scope, icons, and server navigation fallback.

## Treat updates as a state transition

For a waiting-worker flow, establish the sequence:

```text
new worker installed -> waiting -> consent/safe state -> activation
-> controller change -> reload or reconciliation under the update contract
```

- Treat activation and page reload as separate operations. `skipWaiting()` skips
  the waiting phase. `clients.claim()` claims eligible clients. Neither operation
  reloads the document by itself.
- When forcing activation, account for existing pages using a different asset
  or data version. Coordinate affected tabs or maintain mixed-version compatibility.
- Protect pending durable writes before a permitted reload. Consider other open
  tabs rather than checking dirty state in only the initiating tab.
- Give update handling one owner. Ensure that controller changes, prompts, and
  update checks cannot create duplicate reloads or reload loops.
- When an update check or installation fails, keep the current session usable
  and report the failure through the project's error channel.

The [service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
defines waiting and activation. Browser control is not proof that the current
document and every cached resource belong to one release.

## Installation and capabilities

- Verify the built manifest link, resolved start URL, scope, icons, and display
  settings against the supported deployment and browser targets.
- When changing launch URLs, preserve the published app identity. Manifest
  [`id`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
  resolves against the start URL's origin rather than the manifest directory.
  Use an explicit root-relative `id` for an app hosted under a path prefix.
  When `id` was omitted, preserve the previous start URL's effective identity.
- Treat install-prompt APIs as optional. Provide the intended UX when the browser
  does not expose a programmatic prompt.
- Treat standalone display mode as the current launch context. A normal browser
  tab cannot infer that the app is absent from the device from display mode alone.
- When using `beforeinstallprompt`, retain the offered event for a user gesture.
  Call [`prompt()`](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent/prompt)
  at most once per event, then clear the stored event and prompt state.
- Keep manifest validity, browser installation support, and offline behavior as
  separate claims.

## Production checks

Serve built assets in a secure context on a stable origin. Use the project's
existing browser runner. Select scenarios for the changed behavior and affected
guarantees. For manifest or installation changes, check the built manifest and
installation paths without requiring a worker. For caching or worker updates,
establish that the real worker controls the page before testing cached responses.
Use bounded waits so registration or activation failures produce diagnostics.

| Scenario | Required observation |
|---|---|
| Fresh online load in a clean browser context | Manifest and assets resolve at the deployment base. When a worker is expected, registration succeeds without relying on an old cache. |
| Warm offline reload | Supported routes and required assets load from the intended cache, including previously unopened lazy features covered by the offline contract. Unavailable data produces the declared offline state. |
| API failure or missing asset | Navigation fallback cannot disguise the failure as successful HTML. |
| Build A open while build B is deployed | A real update check observes B. Activation and reload follow the chosen dirty-state policy. |
| Two tabs across an update | The supported mixed-version or coordination policy preserves state without reload loops. |
| Failed update/cache write | The app exposes the declared degraded state instead of claiming offline readiness. |
| Path-prefix deployment, when supported | Deep links, icons, manifest URLs, and worker control use the correct base. |

For the two-build check, keep an A-controlled page open while replacing the served
assets with build B at the same origin. Verify that the observed worker and loaded
application actually advance to B when the update is accepted. When the application
supports confirmation, assert both deferred and accepted update paths.

Capability stubs can verify unsupported/denied UI branches. A dev server,
unregistered worker, or mocked cache alone cannot establish production offline
or update behavior. Report any browser-specific installation checks that remain
unverified.
