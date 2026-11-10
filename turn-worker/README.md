# beat-turn-worker

Cloudflare Worker that mints short-lived TURN credentials for the Beat
client. The browser fetches `GET /` and receives a JSON array of
`RTCIceServer` entries that [`src/net/rtcConfig.ts`](../src/net/rtcConfig.ts)
consumes directly via `VITE_ICE_SERVERS_URL`.

## Setup

```sh
cd turn-worker
npm install
npx wrangler login
npx wrangler secret put TURN_TOKEN_ID    # paste your Cloudflare TURN token id
npx wrangler secret put TURN_API_TOKEN   # paste your Cloudflare TURN API token
```

Edit `wrangler.toml` and set `ALLOWED_ORIGINS` to your GitHub Pages origin
(plus `http://localhost:5177` for local dev).

## Local dev

```sh
cp .dev.vars.example .dev.vars   # fill in values for local only
npm run dev
```

Then point the Beat client at the local worker:

```
VITE_ICE_SERVERS_URL=http://127.0.0.1:8787
```

## Deploy

```sh
npm run deploy
```

Use the resulting `https://beat-turn.<your-subdomain>.workers.dev` URL as
`VITE_ICE_SERVERS_URL` in your GitHub Pages build environment.

## Security notes

- Secrets live in Cloudflare, never in the frontend bundle.
- CORS is locked to `ALLOWED_ORIGINS`; update before deploying.
- Credentials are short-lived (`TURN_TTL_SECONDS`, default 24h).
- Rotate `TURN_API_TOKEN` if it ever leaks.

## Validation and failure handling

The Wrangler configuration uses the supported `[[ratelimits]]` binding. Run
`npx wrangler deploy --dry-run --config turn-worker/wrangler.toml` from the repository root to validate the bundle and binding without deploying.

The worker validates a 60–86,400 second integer credential TTL and the provider's ICE response. Invalid configuration or an unavailable limiter returns 503. Provider timeouts, network errors, malformed responses, and unsuccessful responses return a sanitized 502. Provider details are not returned to the browser. The existing origin policy and per-IP limiting remain; Perun's JWT issuer belongs to its separate control plane and is not part of Beat's credential flow.
