# Installed app, offline play and updates

Beat's production build caches the application, simulation worker, Rapier prediction
bundle, styles and icons before reporting offline readiness. After that first download,
Solo, Lab, the workbench and imported/retained replay playback work without a server.
Room discovery, signaling and TURN still need their configured services. Installation
does not make multiplayer offline or guarantee background hosting.

The menu's **App & device** section exposes installation, screen wake lock and waiting
updates. A browser-provided install prompt is consumed once per event. Otherwise the
control explains installation through the browser menu (Safari: Share → Add to Home
Screen). App-window detection describes the current window, not whether another copy
has already been installed. The manifest preserves Beat's existing app identity and
relative scope/start URL, including GitHub Pages deployments under `/beat/`.

## Updates and state loss

New releases finish downloading and wait. Beat does not automatically activate a waiting
worker or reload an existing page. **Apply update** is allowed only in the idle menu;
Solo, Lab, host, client and replay modes reject the action. Leaving a hosted room ends
that room. Results/rematches must retain this protection while their room remains live.

Applying requires confirmation because reload discards in-memory recordings, imported
clips, custom rules and other session UI state. Export the replay or copy rules first.
There is no new durable replay store or storage migration in this change.

The waiting worker checks all open windows under its scope and refuses activation if
any other Beat window/tab exists, even if idle or suspended. Close those windows and
retry. During the request, the initiating UI is inert and start/join/replay entrypoints
are guarded. Only the initiating page reloads on controller change. A timeout or rejected
request restores its controls and leaves its state intact.

The worker retains the current and preceding release's static caches to support a
window opened at the activation boundary. Cleanup is restricted to
`beat-shell:<registration scope>:` caches. Other apps' caches and user data are untouched;
the retired `beat-pwa-v1` cache is no longer read or written. The worker URL stays `sw.js`.
Keep public deployment assets available until the new worker finishes downloading.

## Caching contract

`vite-plugin-pwa` injects the build inventory into `src/pwa/sw.ts`. Installation is
all-or-nothing: a failed precache deletes the incomplete release cache and the current
worker continues serving its release. Individual assets are limited to 4 MiB by build
configuration; the build fails rather than silently excluding oversized physics bundles.
Source maps are not precached.

Only the app root and `index.html` navigations use the cached document. Static inventory
URLs and cached older `/assets/` files use the shell cache. API calls, ICE credentials,
cross-origin traffic and `cache: 'no-store'` requests are not runtime cached. Missing
assets and remote failures retain their network error/status; the worker never substitutes
application HTML. Cached shell readiness says nothing about remote service availability.

## Phone testing and wake lock

Use certificates trusted by the phone, with the laptop's LAN address in their subject
alternative names. Set paths in the shell (do not put private keys in the repository):

```powershell
$env:BEAT_HTTPS_KEY_PATH = 'E:/certs/beat-key.pem'
$env:BEAT_HTTPS_CERT_PATH = 'E:/certs/beat-cert.pem'
npm run dev:https
# For installation, offline operation and updates:
npm run preview:https
```

Open `https://YOUR_LAN_IP:4177/` for the built preview (development uses port 5177).
Installation and storage belong to that exact origin, including address and port. A
stable public HTTPS deployment avoids changing phone origins when the laptop IP changes.
TLS paths are server-only configuration and are never bundled into the client.

**Keep screen awake** is an opt-in session control in the menu and arena. It reports
actual acquisition, releases while hidden, restores opted-in intent on return, and
releases late acquisitions after disposal or cancellation. A system release while visible
requires a new user opt-in. Unsupported browsers and power-policy denial leave play usable.
Wake lock does not promise that a locked/backgrounded phone will keep hosting. Installation
does not increase simulation speed. Existing fullscreen and safe-area controls remain.

## Verification

`npm run test:pwa` builds releases A and B into isolated temporary directories and serves
them at one origin under `/beat/`. It verifies real worker control, first-use offline
simulation/replay/workbench, API and missing-asset failures, uncached ICE, failed update
downloads, connected host/client update deferral, second-tab rejection, cancellation,
successful A→B activation/reload, and preservation of another app's cache. Browser
install/wake UI checks use capability stubs; unit tests cover denial, hide/restore,
system release and acquisition resolving after disposal/cancellation. These do not
establish Android/iOS installation or power-policy behavior on physical phones.

`npm run pwa:icons` regenerates the PNG launch icons from `public/icon.svg` using the
existing Playwright Chromium dependency. The maskable variant keeps the mark inside
its safe zone; `icon-180.png` is the Apple touch icon.
