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

## HTTPS on a same-Wi-Fi phone

Beat's service worker and screen wake lock need a secure context. The localhost
exception on your laptop does not extend to its LAN address on a phone.
`npm run dev:https` and `npm run preview:https` read a PEM key and certificate from
`BEAT_HTTPS_KEY_PATH` and `BEAT_HTTPS_CERT_PATH`. These are server-only settings;
the key and certificate are never bundled into the client.

One local approach is [mkcert](https://github.com/FiloSottile/mkcert). Install it using
its Windows instructions, connect both devices to the same Wi-Fi, then run these
commands from the Beat repository. Replace `YOUR_LAN_IPV4` with the laptop's Wi-Fi
IPv4 address before generating the certificate (`ipconfig` lists your adapters):

```powershell
New-Item -ItemType Directory -Force .certs
mkcert -install
mkcert -key-file .certs/beat-key.pem -cert-file .certs/beat-cert.pem localhost 127.0.0.1 YOUR_LAN_IPV4
$env:BEAT_HTTPS_KEY_PATH = (Resolve-Path .certs/beat-key.pem).Path
$env:BEAT_HTTPS_CERT_PATH = (Resolve-Path .certs/beat-cert.pem).Path
npm run dev:https
```

Allow inbound TCP port **5177** on the laptop's private-network firewall, then open
`https://YOUR_LAN_IPV4:5177/` on the phone. Guest Wi-Fi or client isolation can prevent
devices from reaching each other even when they use the same access point.

For **installation, offline use and service-worker updates**, stop the dev server and
run the built preview in the same shell, retaining those environment variables:

```powershell
npm run preview:https
```

Allow port **4177** and open `https://YOUR_LAN_IPV4:4177/`. The dev server provides hot
reload; it does not register Beat's offline worker. If Vite selects a different port
because the default is occupied, use the URL it prints and allow that port instead.

### Trust the development certificate on the phone

`mkcert -install` trusts its CA on the laptop. The phone needs that CA too. Run
`mkcert -CAROOT` to locate **`rootCA.pem`**, transfer that public certificate to the
phone and install it using the device's certificate settings. On iOS, also enable
full trust for the installed root under Certificate Trust Settings. Consult
[mkcert's mobile instructions](https://github.com/FiloSottile/mkcert#mobile-devices)
for platform details. Merely bypassing a browser certificate warning does not
establish the trusted HTTPS context needed by browser capabilities.

Installing a root CA changes the device's trust store. Use a development CA you
control and remove its trust when finished. **Never transfer or commit
`rootCA-key.pem` or the server's private key.** The included `.certs/.gitignore` keeps
generated certificates and keys out of Git. A trusted reverse proxy or development
tunnel is another option.

Installation and storage belong to the exact origin, including address and port.
Changing the laptop IP requires a certificate covering the new address and creates
a different browser origin. For cross-phone rooms, configure SpacetimeDB discovery
as described in the [README](../README.md#rooms-across-devices); the default browser-local
directory cannot connect different phones. A stable public HTTPS deployment avoids
changing origins when the laptop IP changes.

## Screen wake lock

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
